/* =========================================================================
   ATLAS Utility Web — tools/cop.js
   "COP" — Common Operational Picture (new in 2.5.95; redesigned in 2.6.0).

   WHAT IT DOES
     The shipping (SRF) picture for TTI POCs and management: every active
     shipment as a bubble (last 5 of the WMTR) in one of four steps — TTI
     Quality Review, DTRA Program / Compliance Review, Estimate, Execution
     (split by where the shipment is) — coloured by whether it's on track, needs
     attention or has missed something. Hover a bubble for the latest daily
     update and any open items; click it for the step-by-step checklist. Drafts
     aren't shown; "Delivered - POD Received" and later move to the Closed view,
     which is the post-shipment audit (documents, metrics, close-out).
     Styled like ATLAS so it can move into the ATLAS WMTR dashboard.

   TWO RULE SETS
     Active (copActiveEvaluate, 2.6.0): only what matters day to day — daily
     updates, status / RDD / time in step, the Quality Review minimum fields,
     DTRA's compliance entries, RFQ timing, Cost List + draft CIV + PL before
     DTRA Estimate Review, draft AWB before In Transit, ITN before departure,
     MARAD. "To do" items are what's left in the current step and don't colour
     a bubble; red / amber are things someone can act on now.
     Closed (copEvaluate): the full requirement list, agreed with the shipping
     lead on 21 Oct 2026 (see NOTES.md) — every required document, rejection,
     manual flags, delivered vs. RDD, Ready to Invoice / Invoiced. Checks the
     Christmas Tree already makes come from its own engine (xtBuildRow /
     xtRowIssues) and its acknowledgement list is shared.

   NO MORE OPS TRACKER (2.9.0)
     Date Packed, RFQ Sent Date, ITN / NOEEI Citation, MARAD Submitted Date, the
     invoice-received dates, Monitor this RDD, Shipping Team Notes and Original
     RDD are ATLAS fields now, so nothing is loaded separately. Every check
     reads them, and the Tracker view lays them out the way the Ops Tracker
     did. Shipments delivered before 1 Oct 2026 stay on the archived tracker.
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
/* "Delivered - POD Received" marks the request complete for the requestor, so
   it's closed here too; TTI's close-out (invoices, A/P) is the Closed view. */
function copIsClosedStatus(low) {
  return /^(delivered - pod received|completed|ready to invoice|invoiced|cancel+ed( with (charges|costs))?|shipment cancel+ed)$/.test(low);
}

/* "Stuck" limits — business days in a step before amber / red. OFF by default
   (prefs.stuckOn): the RFQ is the only hard timeline. Management can turn them
   on and edit them under Filter › Day limits. None while moving (in transit /
   customs). */
const COP_STUCK_DEFAULTS = {
  qr:            [2, 3],
  review:        [6, 10],
  estimate_tti:  [4, 6],     // from the pack date: RFQ (1 day) + quotes (1–2) + costs/CIV/PL
  estimate_dtra: [3, 5],
  exec_pre:      [10, 20],
  exec_pod:      [5, 10],
};
const COP_STUCK_LABELS = {
  qr: "TTI Quality Review", review: "DTRA Program / Compliance Review",
  estimate_tti: "TTI Estimate Preparation (from pack date)", estimate_dtra: "DTRA Estimate Review",
  exec_pre: "Pending / Scheduled (before departure)", exec_pod: "Delivered - Pending POD",
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
// The Ops Tracker copy older versions kept in this browser is no longer used — clear it.
try { localStorage.removeItem("atlas.cop.tracker"); } catch (e) { /* storage off */ }

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
  "cop.rdd": "COP: RDD",
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
  relief:  { word: "Relieved",     icon: "✓", cls: "ack",  rank: 5 },   // [RELIEF: …] code in Shipping Team Notes
  later:   { word: "Later step",   icon: "○", cls: "na",   rank: 6 },
  na:      { word: "N/A",          icon: "–", cls: "na",   rank: 7 },
  ok:      { word: "Done",         icon: "✓", cls: "good", rank: 8 },
  todo:    { word: "To do",        icon: "□", cls: "open", rank: 3 },
  late:    { word: "Late",         icon: "✕", cls: "na",   rank: 5 },
  incomplete: { word: "Incomplete", icon: "✕", cls: "na",   rank: 5 },
};

/* -------------------------------------------------------------------------
   STATE
   ------------------------------------------------------------------------- */
const CopUi = {
  view: "active",       // "active" (In progress) | "tracker" | "closed"
  trkScope: "active",   // Tracker view: "active" (default) | "delivered" | "all"
  trkPick: "",          // Tracker view: tile filter (COP_TRK_PICK key)
  trkSort: null,        // Tracker view: { id, dir }
  poc: "",              // TTI POC filter ("" = all; "My shipments only" lives in prefs)
  atRisk: false,        // only shipments with a red/amber item
  rddDays: 0,           // only RDD within N calendar days (0 = any)
  hit: "",              // check id — only shipments missing it ("Metric hits")
  q: "",
  focus: "",            // WMTR picked from the board (highlighted)
  expanded: new Set(),  // WMTRs with the checklist open
  filterOpen: false,
  settingsOpen: false,
  role: "tti",          // "tti" | "requestor" (ATLAS: from the signed-in user)
  reqName: "",          // requestor view: whose requests (stands in for sign-in)
  updMode: false,       // Shipment Details shows the "Enter daily updates" sheet
  updDate: "",          // date for the sheet ("" = today)
  focusUpd: null,       // sheet row to focus after an add
  msg: "",
  _parsed: null,        // { grid, data } — parse cache keyed by grid identity
};

/* Mockup / ATLAS-build features. The Utility can't write to ATLAS, so entering
   and saving daily updates — and WMTR links to the request — are off here;
   the developer mockup (and ATLAS) switch them on. */
const COP_MOCKUP = { editUpdates: false, links: false, requestorView: false };   // links: WMTR numbers open the request; requestorView: the "View as Requestor" switch (ATLAS only)

/* ---- prefs (me + stuck limits) ---- */
function copGetPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(COP_PREFS_KEY) || "{}") || {}; } catch (e) { p = {}; }
  if (typeof p !== "object") p = {};
  // Day limits saved before the 2.6.0 steps (stuckV < 2) used other step names
  // and defaults — start those browsers on the new defaults.
  if (p.stuckV !== 2) { p.stuck = {}; p.stuckV = 2; }
  p.stuck = Object.assign({}, COP_STUCK_DEFAULTS, (p.stuck && typeof p.stuck === "object") ? p.stuck : {});
  p.me = typeof p.me === "string" ? p.me : "";
  p.stuckOn = p.stuckOn === true;          // time-in-step flags: off unless management turns them on
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
    // cols E/F: entry ID + when entered (fetched from ATLAS only; used to edit an entry)
    out.push({ date: d, note: norm(gridCell(grid, k, 4)), id: norm(gridCell(grid, k, 5)), created: xtParseDate(gridCell(grid, k, 6)) });
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
  const ds = { hasCostList: false, hasEstimateList: false, hasWfl: false, hasDaily: false, hasMilestones: false, dpsSince: null, estSince: null };
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
    const shipAct = copReadShipping(grid, rr, rEnd, maxCol);
    if (COP_SHIP_FIELDS.rfq in shipAct || COP_SHIP_FIELDS.packed in shipAct) ds.hasMilestones = true;

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
      ship: shipAct,
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
    Object.assign(CopUi, { poc: "", atRisk: false, rddDays: 0, q: "", hit: "", msg: "", focus: "" });
    CopUi.expanded = new Set();
  }
  return CopUi._parsed.data;
}

/* -------------------------------------------------------------------------
   SHIPMENT MILESTONES — what the Ops Tracker used to hold is in ATLAS now
   (fields added Nov 2026): on Shipping Activity & History — Date Packed, RFQ
   Sent Date, ITN / NOEEI Citation, MARAD Submitted Date, Warehouse Invoice
   Received, Final Shipping Invoice Received, Monitor this RDD, Shipping Team
   Notes — and "Original RDD" on the request. Every check reads those fields.
   Shipments delivered before COP_FIELDS_FROM_ISO (start of FY27) were tracked
   on the Ops Tracker, which is archived: they aren't held to these fields.
   ------------------------------------------------------------------------- */
const COP_FIELDS_FROM_ISO = "2026-10-01";
const COP_SHIP_FIELDS = {
  packed: "date packed", rfq: "rfq sent date", itn: "itn / noeei citation", maradSub: "marad submitted date",
  whInv: "warehouse invoice received", shipInv: "final shipping invoice received",
  monitor: "monitor this rdd", notes: "shipping team notes",
};
const COP_PRE_FIELDS_TEXT = "Delivered before 1 Oct 2026 — tracked on the archived Ops Tracker, not in ATLAS.";
const COP_NO_FIELDS_TEXT = "This UDQ doesn't include the new Shipping Activity fields (Date Packed, RFQ Sent Date, ITN…) — pull or export a fresh one.";
/** Does this record's export carry the milestone columns at all? (older exports don't) */
function copHasMilestones(rec) { return !!rec.ship && (COP_SHIP_FIELDS.rfq in rec.ship || COP_SHIP_FIELDS.packed in rec.ship); }
/** Delivered (or closed out) before the fields existed. */
function copPreFields(rec) {
  const d = xtParseDate(rec.f["delivery date"])
    || (copIsClosedStatus(copLow(rec.f["status"])) ? xtParseDate(rec.f["date completed"]) : null);
  return !!d && xtIso(d) < COP_FIELDS_FROM_ISO;
}
/** The milestone fields of one record, as entered in ATLAS (text). */
function copMilestones(rec) {
  const o = {};
  for (const k of Object.keys(COP_SHIP_FIELDS)) o[k] = norm(rec.ship[COP_SHIP_FIELDS[k]] || "");
  return o;
}
/** What the checks read: the milestones, or null when this record isn't held to
    them (older export, or delivered before 1 Oct 2026 — see `why`). */
function copMsFor(rec, ds) {
  if (!ds || !ds.hasMilestones) return { trk: null, why: COP_NO_FIELDS_TEXT, na: false };
  if (copPreFields(rec)) return { trk: null, why: COP_PRE_FIELDS_TEXT, na: true };
  return { trk: copMilestones(rec), why: "", na: false };
}
function copIsYes(v) { return /^(true|yes|y|1)$/i.test(norm(v || "")); }

/* -------------------------------------------------------------------------
   RELIEF CODES (2.9.3) — a shipment can be relieved of a check by a tag typed
   in ATLAS "Shipping Team Notes":   [RELIEF: RFQ] reason…
   Several codes can share one tag ([RELIEF: RFQ, EEI] reason) and a note can
   carry several tags; the text after a tag, up to the next one, is its reason.
   A relieved check shows "Relieved" with the reason instead of a miss — for
   everyone, because it lives in ATLAS (the per-browser Acknowledge button is
   separate). Each code maps onto the acknowledge key(s) of the checks it covers.
   ------------------------------------------------------------------------- */
const COP_RELIEF_CODES = [
  ["RFQ",   "RFQ sent within 1 business day",              ["cop.rfq"]],
  ["EEI",   "EEI / AES filed before departure (ITN)",       ["cop.itn"]],
  ["DAILY", "Daily status updates",                         ["activity"]],
  ["RDD",   "RDD — delivered on time, monitored RDD",       ["delivery", "cop.rdd"]],
  ["COST",  "Cost more than 10% over the approved amount",  ["variance_est", "variance_rev"]],
  ["DOCS",  "Required shipping documents",                  ["docs"]],
  ["MARAD", "MARAD report (sealift)",                       ["cop.marad"]],
  ["ALL",   "Every check on this shipment",                 ["*"]],
];
const COP_RELIEF_ALIAS = { AES: "EEI", ITN: "EEI", DOC: "DOCS", DOCUMENTS: "DOCS", DELIVERY: "RDD", UPDATE: "DAILY", UPDATES: "DAILY", "*": "ALL" };
const COP_RELIEF_RE = /\[\s*RELIEF\s*[:\-–—]?\s*([^\]]*)\]\s*([^\[]*)/gi;
/** Shipping Team Notes text -> { list: [{code, reason, keys}], unknown: [codes not recognised] }. */
function copParseRelief(text) {
  const out = { list: [], unknown: [] };
  const s = String(text || "");
  let m;
  COP_RELIEF_RE.lastIndex = 0;
  while ((m = COP_RELIEF_RE.exec(s))) {
    const reason = norm(m[2]).replace(/[\s.;,]+$/, "");
    for (let code of m[1].toUpperCase().split(/[\s,;\/&+]+/).filter(Boolean)) {
      code = COP_RELIEF_ALIAS[code] || code;
      const def = COP_RELIEF_CODES.find((d) => d[0] === code);
      if (!def) { out.unknown.push(code); continue; }
      if (!out.list.some((x) => x.code === code)) out.list.push({ code, reason, keys: def[2] });
    }
  }
  return out;
}
/** The relief on one record (parsed once). */
function copReliefFor(rec) {
  const txt = (rec.ship && rec.ship[COP_SHIP_FIELDS.notes]) || "";
  if (!rec._relief || rec._relief.src !== txt) { rec._relief = copParseRelief(txt); rec._relief.src = txt; }
  return rec._relief;
}
/** { request number: [{code, reason, keys}] } for every record in a UDQ grid whose
    Shipping Team Notes carry a relief tag. Read from the grid itself so the
    metrics engines (PMR, Metrics tab, rollup) can ask without the Dashboard. */
const _copReliefCache = new WeakMap();
function copReliefByRequest(grid) {
  if (!grid || typeof grid !== "object") return {};
  let m = _copReliefCache.get(grid);
  if (m) return m;
  m = {};
  const maxRow = gridMaxRow(grid), maxCol = gridMaxCol(grid);
  let req = "";
  for (let r = 2; r <= maxRow; r++) {
    const a = norm(gridCell(grid, r, 1));
    if (a && xtLooksWmtr(a)) { req = xtStripSuffix(a); continue; }
    if (!req || copLow(gridCell(grid, r, 2)) !== "shipping activity & history") continue;
    for (let col = 2; col <= maxCol; col++) {
      if (copLow(gridCell(grid, r + 1, col)) !== COP_SHIP_FIELDS.notes) continue;
      const rel = copParseRelief(gridCell(grid, r + 2, col));
      if (rel.list.length) m[req] = rel.list;
      break;
    }
  }
  _copReliefCache.set(grid, m);
  return m;
}
/** The relief entry that covers a check with these acknowledge keys, or null. */
function copReliefHit(relief, keys) {
  if (!relief || !relief.list.length) return null;
  return relief.list.find((x) => x.keys.indexOf("*") !== -1 || x.keys.some((k) => keys.indexOf(k) !== -1)) || null;
}
/** "Relieved (RFQ) — reason. " — prefix for a relieved check's detail. */
function copReliefText(hit) { return `Relieved (${hit.code})${hit.reason ? " — " + hit.reason : ""}. `; }
/** Team notes with each [RELIEF: …] tag shown as a pill. */
function copNotesHtml(text) {
  return esc(text).replace(/\[\s*RELIEF\s*[:\-–—]?\s*([^\]]*)\]/gi, (m0, codes) => `<span class="copx-pill t">Relief: ${norm(codes).toUpperCase()}</span>`);
}
/** Hover legend for the relief codes (page header + Team notes column). */
function copReliefLegend() {
  return `<span class="copx-help" tabindex="0" role="button" aria-label="Relief codes — how to relieve a shipment from a check">Relief codes
    <span class="pop" role="tooltip"><b class="t">Relief codes</b>
      Type a tag in ATLAS › Shipping Activity › <b>Shipping Team Notes</b>, then the reason:<br>
      <code>[RELIEF: RFQ] DTRA asked for the quote before packing</code>
      <span class="rcs">${COP_RELIEF_CODES.map((d) => `<button type="button" class="rc" data-relief="${d[0]}" title="Copy [RELIEF: ${d[0]}] to the clipboard"><b>${d[0]}</b><span>${esc(d[1])}</span><i>Copy</i></button>`).join("")}</span>
      <span class="ex"><b>Click a code to copy its tag</b>, then paste it into Shipping Team Notes and add the reason. Several at once: <code>[RELIEF: RFQ, EEI] reason</code>. The item then shows “Relieved” with the reason, for everyone, instead of a miss.</span></span></span>`;
}
const COP_RELIEF_TITLE = "ATLAS field: Shipping Team Notes. Relief codes — [RELIEF: CODE] reason — " + COP_RELIEF_CODES.map((d) => `${d[0]} = ${d[1]}`).join("; ");

/** Key dates of one request, start to finish — the Ops Tracker's date columns,
    read from the Workflow Logs (oldest stamp of each status), the milestone
    fields and Shipping Activity. Missing = null. */
function copTimeline(rec) {
  const oldest = (re) => { let d = null; for (const e of rec.wfl) if (e.dt && re.test(copLow(e.status))) d = e.dt; return d; };
  const ms = (k) => xtParseDate(rec.ship[COP_SHIP_FIELDS[k]] || "");
  const ship = (h) => xtParseDate(rec.ship[h] || "");
  return {
    submitted: xtParseDate(rec.f["date submitted"]) || oldest(/^(?!draft)./),   // else the first stamp after Draft
    toDtra: oldest(/^dtra program review$/),
    compliance: oldest(/^dtra compliance review \(approved\)$/),
    packed: ms("packed"),
    rfq: ms("rfq"),
    quoteSub: oldest(/^dtra estimate review$/),
    quoteAppr: oldest(/^dtra estimate review \(approved\)$/) || oldest(/^dtra approved$/),
    etd: ship("departure from origin est. date"),
    departed: ship("departure from origin act. date"),
    delivered: xtParseDate(rec.f["delivery date"]),
    origRdd: xtParseDate(rec.f["original rdd"]),
    rdd: xtParseDate(rec.f["nlt completion date"]),
  };
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
 * ctx = { today, prefs, ds, ignores }
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
  // Milestone fields (ATLAS): null when this record isn't held to them — `ms.why` says why.
  const ms = copMsFor(rec, ctx.ds);
  const relief = copReliefFor(rec);                    // [RELIEF: …] tags in Shipping Team Notes
  const trk = ms.trk;
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
    const rl = copReliefHit(relief, keys);
    if (rl && state !== "ok" && state !== "na") { detail = copReliefText(rl) + detail; state = "relief"; }
    else if ((state === "fail" || state === "warn" || state === "due") && isAcked(keys)) {
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
    // xtRowIssues only raises this when the actual is more than 10% over the approved amount (xtCostOver).
    add("cost", "general", "req", "Cost vs. DTRA-approved amount",
      { state: li.closed || delivered ? "warn" : "fail",
        detail: `${h.label} (approved ${copMoney(xrow.governing_amount) || "—"}, current ${copMoney(xrow.current_total_cost) || "—"}).` }, [m]);
  }
  if (li.closed) {
    for (const m of ["rti", "invoiced"]) for (const h of xHit(m))
      add(m, "general", "req", m === "rti" ? "Ready to Invoice" : "Invoiced", { state: h.kind === "due" ? "due" : "warn", detail: h.label }, [m]);
  }

  /* Closed = post-shipment audit: metric hits only. The step-by-step quality
     checks (addresses, inventory fields, weights/dims, cost list, DPS…) only
     matter while the request moves between steps — see copActiveEvaluate. */

  /* ===================== 5 · ESTIMATE ===================== */
  const compApproved = oldestOf("dtra compliance review (approved)");
  (function () {
    const label = "RFQ sent within 1 business day of Compliance approval and the pack date";
    if (!compApproved) {
      add("rfq", "estimate", "req", label, laneIdx > COP_LANE_IDX.compliance
        ? { met: null, detail: "No \"DTRA Compliance Review (Approved)\" stamp in the Workflow Logs." }
        : { state: laneIdx < 0 ? "na" : "later", detail: "Clock starts when Compliance Review is approved." });
      return;
    }
    if (!trk) { add("rfq", "estimate", "req", label, { met: ms.na ? "na" : null, detail: ms.why }); return; }
    if (!copIsoToDate(trk.rfq) && sc.handCarry) { add("rfq", "estimate", "req", label, { met: "na", detail: "Hand carry — no RFQ." }); return; }
    const packed = copIsoToDate(trk.packed);
    const due = xtWorkday(packed && packed.getTime() > compApproved.getTime() ? packed : compApproved, 1, true);
    const sent = copIsoToDate(trk.rfq);
    // Text instead of a date ("Hand Carry", "FEDEX", "N/A") = no RFQ for this one.
    if (!sent && norm(trk.rfq)) { add("rfq", "estimate", "req", label, { met: "na", detail: `RFQ Sent Date shows "${trk.rfq}" — no RFQ needed.` }); return; }
    if (sent) {
      add("rfq", "estimate", "req", label, sent.getTime() <= due.getTime()
        ? { state: "ok", detail: `Sent ${copFmt(sent)} (due ${copFmt(due)}).` }
        : { state: "fail", detail: `Sent ${copFmt(sent)}, after the ${copFmt(due)} due date.` });
    } else if (today.getTime() > due.getTime()) {
      add("rfq", "estimate", "req", label, { state: "fail", detail: `RFQ Sent Date is blank in ATLAS; it was due ${copFmt(due)}.` });
    } else {
      add("rfq", "estimate", "req", label, { state: "due", detail: `Due ${copFmt(due)}.` });
    }
  })();
  // Date Packed: every request that got past the estimate needs it on the record.
  if (trk && laneIdx > COP_LANE_IDX.estimate && !sc.handCarry) {
    const packed = copIsoToDate(trk.packed);
    add("packed", "estimate", "req", "Date Packed entered",
      packed ? { state: "ok", detail: `Packed ${copFmt(packed)}.` } : { state: "warn", detail: "Date Packed is blank in ATLAS." }, ["cop.packed"]);
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
  docRule("civ", "Commercial Invoice attached", "ready", full);
  docRule("pkl", "Packing List attached", "ready", full, () => !sc.originUs && copHasType(types, ["IPC"]));
  docRule("sli", "SLI attached (US export)", "ready", full && exportUs && !copHasType(types, ["MFR_NO AES"]));
  docRule("aes", "AES record or MFR_NO AES attached (US export)", "ready", full && exportUs);
  // AES / ITN. Required for every US export (origin US, destination abroad),
  // hand carry excepted — decided from the ATLAS route, not a tracker class.
  // The export date is ATLAS "Departure from Origin Est. Date"; once the
  // shipment has actually departed (Act. Date, or status Picked Up or later)
  // without an ITN it's a hard red. The ITN / NOEEI citation is the ATLAS
  // Shipping Activity field of that name.
  (function () {
    const label = "AES filed / ITN before departure";
    if (!exportUs) return;
    if (sc.handCarry) { add("itn", "ready", "req", label, { met: "na", detail: "Hand carry — AES not checked." }); return; }
    const depAct = xtParseDate(rec.ship["departure from origin act. date"]);
    const etd = xtParseDate(rec.ship["departure from origin est. date"]);
    const left = !!depAct || laneIdx >= COP_LANE_IDX.transit;
    const notYet = laneIdx < COP_LANE_IDX.ready;
    const itn = trk ? norm(trk.itn) : "";
    if (itn) {
      const filed = /^\d{4}-\d{2}-\d{2}$/.test(itn) ? copIsoToDate(itn) : null;
      add("itn", "ready", "req", label, { state: "ok", detail: filed ? `ITN filed ${copFmt(filed)}.` : `${/^x\d/i.test(itn) ? "ITN" : "Exemption / citation"}: ${itn}.` });
      return;
    }
    if (!trk) { add("itn", "ready", "req", label, { met: ms.na ? "na" : null, detail: `US export — AES required. ${ms.why}` }); return; }
    if (left) { add("itn", "ready", "req", label, { state: "fail", detail: `Departed without an ITN — ${depAct ? `left origin ${copFmt(depAct)}` : `status is "${li.status}"`} and ATLAS has no ITN / NOEEI citation.` }); return; }
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
  // submitted date is the ATLAS field "MARAD Submitted Date".
  if (sc.ocean) {
    const label = "MARAD report (sealift)";
    const loaded = xtParseDate(rec.ship["departure from origin act. date"]);
    const days = sc.originUs ? COP_MARAD_WORKDAYS_US : COP_MARAD_WORKDAYS_FOREIGN;
    const due = loaded ? xtWorkday(loaded, days, true) : null;
    const rule = `${days} working days after departure from origin`;
    const sub = trk ? copIsoToDate(trk.maradSub) : null;
    if (sub) add("marad", "transit", "req", label, { state: "ok", detail: `Submitted ${copFmt(sub)}${due ? ` (due ${copFmt(due)})` : ""}.` });
    else if (trk && /^n\/?a$/i.test(trk.maradSub)) add("marad", "transit", "req", label, { state: "na", detail: "MARAD Submitted Date shows N/A (e.g. waiver)." });
    else if (!loaded && li.closed) add("marad", "transit", "req", label, { met: null, detail: `No "Departure from Origin Act. Date" in ATLAS, so the due date (${rule}) can't be worked out.` });
    else if (!loaded) add("marad", "transit", "req", label, { state: laneIdx < COP_LANE_IDX.transit ? "later" : "open", detail: `Due ${rule}; no "Departure from Origin Act. Date" in ATLAS yet.` });
    else if (!trk) add("marad", "transit", "req", label, { met: ms.na ? "na" : null, detail: `Due ${copFmt(due)} (${rule}). ${ms.why}` });
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
  if (copLow(li.status) === "delivered - pending pod" && hasDoc("pod")) {
    add("podstatus", "delivered", "rec", "Status updated to POD Received", { state: "warn", detail: "POD is attached but the status is still \"Delivered - Pending POD\"." });
  }
  // Delivered after the RDD is only an audit hit when "Monitor this RDD" is ticked in ATLAS (2.9.10) — same switch
  // as the In progress view. (The Metrics tab's on-time delivery % is a separate figure and still counts every RDD.)
  if (!copIsYes(rec.ship[COP_SHIP_FIELDS.monitor])) {
    if (delivered && rdd) add("late", "delivered", "req", "Delivered on or before RDD", { met: "na", detail: `RDD not monitored in ATLAS — delivered ${copFmt(delivered)}, RDD ${copFmt(rdd)}.` }, ["delivery"]);
  } else {
    for (const h of xHit("delivery")) add("late", "delivered", "req", "Delivered on or before RDD",
      { state: "fail", detail: `${h.label} — delivered ${copFmt(delivered)}, RDD ${copFmt(rdd)}.` }, ["delivery"]);
    if (delivered && rdd && !xHit("delivery").length) add("late", "delivered", "req", "Delivered on or before RDD", { state: "ok", detail: `Delivered ${copFmt(delivered)}, RDD ${copFmt(rdd)}.` }, ["delivery"]);
  }

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
    consol, checks, counts, stageWorst, trk, relief: relief.list, requestor: f["requestor name"] || "",
  };
}

/* =========================================================================
   ACTIVE COP — the day-to-day picture (2.6.0 redesign).
   Four steps; Drafts aren't shown; "Delivered - POD Received" and later are
   closed. Only checks that matter while a shipment is moving, and only the
   ones someone can act on now count as open items:
     · a daily update every business day (from the business day after Draft)
     · problem status, Red Flag, RDD, time in step, cost over the approved amount
     · TTI Quality Review: min. inventory fields, addresses/POCs, country match
     · after DTRA Compliance: BIS/DDTC auth on every line, Denied Party Screen
     · Estimate: RFQ within 1 business day of Compliance approval + pack date;
       Cost List, draft CIV and PL before DTRA Estimate Review
     · Execution: draft AWB before In Transit, ITN before departure (US
       exports), carrier + AWB/BoL # once moving, MARAD (sealift)
   Everything document-heavy (PO, POD, VAT, placards, invoices…) is the Closed
   view's post-shipment audit, which runs the full copEvaluate rule set.
   ========================================================================= */
const COP_STEPS = [
  { id: "qr",       n: 1, label: "TTI Quality Review",               sub: "TTI" },
  { id: "review",   n: 2, label: "DTRA Program / Compliance Review", sub: "DTRA" },
  { id: "estimate", n: 3, label: "Estimate Preparation",             sub: "TTI preparation · DTRA review" },
  { id: "exec",     n: 4, label: "Execution",                        sub: "Pending → Delivered" },
];
const COP_STEP_IDX = { qr: 0, review: 1, estimate: 2, exec: 3 };
const COP_STATUS_STEP = {
  "tti quality review": "qr",
  "dtra program review": "review",
  "dtra compliance review": "review",
  "tti estimate preparation": "estimate",
  "ct program > 100k approval": "estimate",
  "dtra estimate review": "estimate",
};
/* Execution, split by where the shipment physically is. */
const COP_EXEC_PHASES = [
  { id: "pre",      label: "Pending Pre-clearance",       statuses: ["dtra approved", "pending"] },
  { id: "booked",   label: "Booked / picked up",          statuses: ["scheduled", "picked up", "arrived warehouse", "departed warehouse"] },
  { id: "transit",  label: "In transit",                  statuses: ["in transit", "arrived pol", "departed pol", "arrived transshipment port", "departed transshipment port", "arrived pod", "departed pod"] },
  { id: "customs",  label: "Customs",                     statuses: ["awaiting customs clearance", "cleared customs"] },
  { id: "delivery", label: "Delivery",                    statuses: ["out for delivery", "failed delivery attempt", "delivered - pending pod"], optional: true },
];
const COP_PHASE_IDX = { pre: 0, booked: 1, transit: 2, customs: 3, delivery: 4 };
/* Program/Compliance Review and Estimate, split by the exact ATLAS status. */
const COP_STEP_SUBS = {
  review: [
    { id: "program",    label: "DTRA Program Review",                 statuses: ["dtra program review"] },
    { id: "compliance", label: "DTRA Compliance Review",              statuses: ["dtra compliance review"] },
  ],
  estimate: [
    { id: "tti",        label: "TTI Estimate Preparation",            statuses: ["tti estimate preparation"] },
    { id: "ct",         label: "CT Program > $100K Approval",         statuses: ["ct program > 100k approval"], optional: true },
    { id: "dtra",       label: "DTRA Estimate Review",                statuses: ["dtra estimate review"] },
  ],
};
/* Inner boxes marked `optional` (rarely-used statuses) only show when a
   shipment in view is in them — keeps the board clean. */
function copShowSub(p, n) { return n > 0; }   // an empty box inside a step isn't drawn (2.9.10)
function copStepSubOf(step, low) {
  const subs = COP_STEP_SUBS[step];
  if (!subs) return null;
  for (const p of subs) if (p.statuses.indexOf(low) !== -1) return p.id;
  return subs[0].id;
}
function copExecPhaseOf(low) {
  for (const p of COP_EXEC_PHASES) if (p.statuses.indexOf(low) !== -1) return p.id;
  return null;
}
function copStepOfStatus(low) { return COP_STATUS_STEP[low] || (copExecPhaseOf(low) ? "exec" : null); }
function copIsProblemOnly(low) { return COP_PROBLEM_STATUSES.has(low) && !copExecPhaseOf(low); }

/** Oldest Workflow Logs date of the newest unbroken run of statuses matching
    `match` (problem statuses inside the run don't break it). */
function copRunSince(wfl, match) {
  let since = null, started = false;
  for (const e of wfl) {
    const b = copBaseStatus(e.status);
    if (match(b)) { since = e.dt || since; started = true; continue; }
    if (copIsProblemOnly(b)) continue;
    break;
  }
  return started ? since : null;
}

/** Step, Execution phase and timing for an active record. */
function copStepInfo(rec) {
  const status = rec.f["status"] || "";
  const low = copLow(status);
  const draft = /^draft\b/.test(low);
  const closed = copIsClosedStatus(low);
  const problem = COP_PROBLEM_STATUSES.has(low);
  let step = copStepOfStatus(low);
  let phase = copExecPhaseOf(low);
  let sub = copStepSubOf(step, low);
  if (!step && !closed && !draft) {
    for (const e of rec.wfl) {
      const b = copBaseStatus(e.status);
      if (copIsProblemOnly(b)) continue;
      const s = copStepOfStatus(b);
      if (s) { step = s; phase = copExecPhaseOf(b); sub = copStepSubOf(s, b); break; }
    }
    if (!step && problem) { step = "exec"; phase = "pre"; }
  }
  const stepSince = step ? copRunSince(rec.wfl, (b) => copStepOfStatus(b) === step) : null;
  let stuckKey = step, stuckSince = stepSince;
  if (step === "estimate") {
    const tti = low === "tti estimate preparation";
    stuckKey = tti ? "estimate_tti" : "estimate_dtra";
    stuckSince = copRunSince(rec.wfl, (b) => tti ? b === "tti estimate preparation" : (b === "dtra estimate review" || b === "ct program > 100k approval"));
  } else if (step === "exec") {
    if (phase === "pre" || phase === "booked") {
      stuckKey = "exec_pre";
      stuckSince = copRunSince(rec.wfl, (b) => { const ph = copExecPhaseOf(b); return ph === "pre" || ph === "booked"; });
    } else if (low === "delivered - pending pod") {
      stuckKey = "exec_pod";
      stuckSince = copRunSince(rec.wfl, (b) => b === "delivered - pending pod");
    } else { stuckKey = null; stuckSince = null; }    // moving: RDD + daily updates cover it
  }
  return { status, low, draft, closed, problem, step, phase, sub, stepIdx: step ? COP_STEP_IDX[step] : -1,
           unmapped: !step && !closed && !draft, stepSince, stuckKey, stuckSince };
}

/** Country name -> comparable key ("GEORGIA - GE" -> "GEORGIA"; every US spelling -> "US"). */
function copCountryKey(s) {
  const k = copShortCountry(s).toUpperCase().trim();
  return _raIsUs(k) ? "US" : k;
}

/** The Christmas Tree's row + issues for one record (cost vs. approved, red flag). */
function copXt(rec, status) {
  const f = rec.f;
  const xrow = xtBuildRow({
    service: "SRF", wmtr: rec.wmtr,
    scalar: {
      ttiPoc: f["tti poc name"] || "", redFlag: f["red flag"] || "", redFlagComments: f["red flag comments"] || "",
      topRequired: f["transfer of property (top) required?"] || "", totalCost: f["total cost in usd"] || "",
      dateSubmitted: f["date submitted"] || "", originalRdd: f["original rdd"] || "",
      nltCompletion: f["nlt completion date"] || "", status,
      dateCompleted: f["date completed"] || "", deliveryDate: f["delivery date"] || "",
      manualMetric: xtManualMetricNote(f["dtra-only import/export comments"], f["revision number"]),
    },
    wfl: rec.wfl,
    lastActivity: rec.daily.length ? rec.daily.reduce((m, x) => (!m || x.date > m ? x.date : m), null) : null,
    activityDates: rec.daily.map((x) => x.date),
    shipping: { carrier: rec.ship["carrier / freight forwarder"] || "", awb: rec.ship["awb/bol"] || "", tracklink: rec.ship["tracking link"] || "" },
  });
  return { xrow, xissues: xtRowIssues(xrow) };
}

/** Build the active-COP view of one record; null for Drafts and closed records. */
function copActiveEvaluate(rec, ctx) {
  const si = copStepInfo(rec);
  if (si.draft || si.closed) return null;
  const f = rec.f, today = ctx.today, wfl = rec.wfl;
  const sc = copShipClass(rec);
  const stepIdx = si.stepIdx;
  const phaseIdx = si.phase ? COP_PHASE_IDX[si.phase] : -1;
  const moving = si.step === "exec" && phaseIdx >= COP_PHASE_IDX.transit;   // departed origin
  const types = rec.att.map((a) => a.type);
  const hasType = (list) => copHasType(types, list);
  const ms = copMsFor(rec, ctx.ds);
  const relief = copReliefFor(rec);                    // [RELIEF: …] tags in Shipping Team Notes
  const trk = ms.trk;                                  // ATLAS milestone fields (null: see ms.why)
  const ig = ctx.ignores[rec.reqNo] || [];
  const isAcked = (keys) => ig.indexOf("*") !== -1 || keys.some((k) => ig.indexOf(k) !== -1);
  const delivered = xtParseDate(f["delivery date"]);
  const rdd = xtParseDate(f["nlt completion date"]);
  const oldestOf = (name) => { let d = null; for (const e of wfl) if (copLow(e.status) === name) d = e.dt; return d; };
  const { xrow, xissues } = copXt(rec, si.status);
  const xHit = (m) => xissues.filter((i) => i.metric === m);

  const checks = [];
  const add = (id, step, label, state, detail, ackKeys, brief) => {
    const keys = ackKeys || ["cop." + id];
    const rl = copReliefHit(relief, keys);
    if (rl && state !== "ok" && state !== "na") { detail = copReliefText(rl) + detail; state = "relief"; }
    else if ((state === "fail" || state === "warn") && isAcked(keys)) { detail = "Acknowledged — " + detail; state = "ack"; }
    checks.push({ id, stage: step, label, state, detail, ackKey: keys[0], brief: brief || label });   // brief = hover line
  };
  /** A requirement of `step`: "to do" while it's that step's job, amber once
      the shipment has moved past the point it was needed (`overdue`). */
  const gate = (id, step, label, met, missDetail, okDetail, overdue, ackKeys) => {
    let state;
    if (met === null) state = "unknown";
    else if (met === "na") state = "na";
    else if (met) state = "ok";
    else if (overdue === "incomplete") state = "incomplete";   // still not filled in; doesn't colour the bubble
    else if (overdue) state = "warn";
    else if (stepIdx >= COP_STEP_IDX[step]) state = "todo";
    else state = "later";
    add(id, step, label, state, met === true || met === "na" ? okDetail : missDetail, ackKeys);
  };

  /* ---------- throughout ---------- */
  if (si.problem) add("status", "general", "Shipment status", "fail", `ATLAS status is "${si.status}".`, null, `Status: ${si.status}`);
  else if (si.unmapped) add("status", "general", "Shipment status", "warn", `"${si.status || "(blank)"}" isn't a status the COP knows, so it can't be placed in a step.`);
  if (/^true$/i.test(f["red flag"] || "")) add("redflag", "general", "Red Flag", "fail", xrow.red_flag || "Red Flag is set on the request.");

  // Daily update: every business day from the business day after the request
  // left Draft (never before ATLAS logged updates) until delivery.
  const daily = { missed: [], dueToday: false, last: xrow.last_activity || null, start: null };
  (function () {
    let start = null;
    for (const e of wfl) if (e.dt && !/^draft\b/i.test(norm(e.status)) && (!start || e.dt.getTime() < start.getTime())) start = e.dt;
    if (start) start = xtWorkday(start, 1, true);
    const logStart = typeof PMR_DAILY_LOG_START_ISO !== "undefined" ? xtParseDate(PMR_DAILY_LOG_START_ISO) : null;
    if (start && logStart && start.getTime() < logStart.getTime()) start = logStart;
    for (const x of rec.daily) if (!start || x.date.getTime() < start.getTime()) start = x.date;
    const label = "Daily status update";
    const lastTxt = daily.last ? `Last update ${copFmt(daily.last)}.` : "No updates yet.";
    if (!start) { add("daily", "general", label, "unknown", "No Workflow Logs stamp or daily entry to count from.", ["activity"]); return; }
    daily.start = start;
    const end = delivered || (si.low === "delivered - pending pod" ? si.stuckSince : null);
    const pend = ((ctx.drafts && ctx.drafts[rec.wmtr]) || []).map((x) => xtParseDate(x.date)).filter(Boolean);
    const g = copDailyGaps(rec.daily.map((x) => x.date).concat(pend), start, end);
    daily.missed = g.missed; daily.dueToday = g.dueToday;
    if (g.missed.length) {
      const shown = g.missed.slice(-5);
      add("daily", "general", label, "fail",
        `Missing ${copPlural(g.missed.length, "business day")} (${g.missed.length > shown.length ? "latest: " : ""}${xtFmtDayList(shown)}). ${lastTxt}`, ["activity"]);
    } else if (g.dueToday) add("daily", "general", label, "todo", `Today's update isn't in yet. ${lastTxt}`, ["activity"]);
    else add("daily", "general", label, "ok", `Up to date. ${lastTxt}`, ["activity"]);
  })();

  // RDD. Requestors set it without validation and it's routinely moved to
  // the delivery date afterwards, so it isn't checked at all unless a request
  // with a firm date (training event, travellers) is switched to RDD
  // monitoring in its details — then it's amber 5 business days out and red
  // once passed, at any step.
  const rddWatch = copIsYes(rec.ship[COP_SHIP_FIELDS.monitor]);   // ATLAS "Monitor this RDD" — the only switch (2.9.4)
  if (rddWatch && !delivered && si.low !== "delivered - pending pod") {
    const tag = "Monitored RDD";
    if (!rdd) add("rdd", "general", tag, "unknown", "No NLT Completion Date (RDD) on the request.");
    else if (rdd.getTime() < today.getTime()) {
      const ago = copPlural(copCalDays(rdd, today), "day");
      add("rdd", "general", tag, "fail", `RDD ${copFmt(rdd)} passed ${ago} ago.`, null, `RDD passed ${copFmt(rdd)} (monitored)`);
    } else {
      const bd = copBizDaysBetween(today, rdd);
      add("rdd", "general", tag, bd <= COP_RDD_WARN_BDAYS ? "warn" : "ok",
        `RDD ${copFmt(rdd)} (${copPlural(bd, "business day")} away).`,
        null, `RDD ${copFmt(rdd)} — ${copPlural(bd, "business day")} away`);
    }
  }

  // Time in step. TTI Estimate Preparation can't start until the cargo is
  // packed (weights/dims drive the RFQ), so its clock starts at the later of
  // entering the step and the pack date — and doesn't run until there is one.
  // Off by default: the RFQ is the only hard timeline. Management can switch
  // these flags on under Filter › Day limits.
  const lim = si.stuckKey && ctx.prefs.stuckOn ? ctx.prefs.stuck[si.stuckKey] : null;
  let stuckState = "";
  let stuckSince = si.stuckSince;
  let waitingPack = false;
  if (si.stuckKey === "estimate_tti") {
    const packed = trk ? copIsoToDate(trk.packed) : null;
    if (!packed) waitingPack = true;
    else if (!stuckSince || packed.getTime() > stuckSince.getTime()) stuckSince = packed;
  }
  if (lim && waitingPack) {
    add("stuck", "general", "Time in this step", "todo",
      "Waiting on the pack date — the Estimate Preparation clock starts once the cargo is packed.");
  } else if (lim) {
    if (!stuckSince) add("stuck", "general", "Time in this step", "unknown", "No Workflow Logs entry shows when it got here.");
    else {
      const n = copBizDaysBetween(stuckSince, today);
      stuckState = n >= lim[1] ? "fail" : n >= lim[0] ? "warn" : "ok";
      add("stuck", "general", "Time in this step", stuckState,
        `${copPlural(n, "business day")} in ${COP_STUCK_LABELS[si.stuckKey]} since ${copFmt(stuckSince)} (amber at ${lim[0]}, red at ${lim[1]}).`,
        null, `${copPlural(n, "business day")} in ${COP_STUCK_LABELS[si.stuckKey]} (limit ${lim[1]})`);
    }
  }

  // Cost above the governing DTRA-approved amount — only once it's more than
  // 10% over (Christmas Tree rule + the 10% tolerance).
  for (const m of ["variance_est", "variance_rev"]) for (const h of xHit(m)) {
    const appr = xrow.governing_amount, cur = xrow.current_total_cost;
    if (!xtCostOver(xrow)) continue;
    add("cost", "general", "Cost vs. DTRA-approved amount", "warn",
      `Cost is ${Math.round((cur / appr - 1) * 100)}% over the DTRA-approved amount (approved ${copMoney(appr)}, current ${copMoney(cur)}).`, [m], "Cost is over the DTRA-approved amount by more than 10%");
  }

  /* ---------- 1 · TTI Quality Review ----------
     Completeness, not timing: once the request has moved on, a gap here shows
     as "Incomplete" but doesn't colour the bubble (the Closed audit counts it). */
  const pastQr = stepIdx > COP_STEP_IDX.qr ? "incomplete" : false;
  const { items } = copInvLines(rec);
  (function () {
    const FIELDS = [
      ["Description", (r) => r["description"]], ["Qty", (r) => r["quantity"]],
      ["U/M", (r) => r["unit of measure"]], ["U/I", (r) => r["unit of issue"]],
      ["ECCN/USML", (r) => copInv(r, /^eccn/)], ["Sched B/HTS", (r) => copInv(r, /schedule b|hts/)],
      ["Cntry of Mfg", (r) => copInv(r, /country of origin/)], ["Value", (r) => copInv(r, /^value/)],
    ];
    const label = "Inventory: minimum fields on every line";
    if (!items.length) { gate("inv", "qr", label, false, "No inventory lines on the request.", "", pastQr); return; }
    const miss = FIELDS.map(([n, get]) => [n, items.filter((r) => !norm(get(r))).length]).filter((x) => x[1]);
    gate("inv", "qr", label, !miss.length,
      `Missing on ${copPlural(items.length, "line")}: ${miss.map(([n, k]) => `${n} (${k})`).join(", ")}.`,
      `All ${copPlural(items.length, "line")} complete.`, pastQr);
  })();
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
    gate("parties", "qr", "Addresses & POCs (except Intermediate Consignee)", !gaps.length,
      `Missing: ${gaps.join("; ")}.`, "All filled.", pastQr);
  })();
  (function () {
    const bad = [];
    const cmp = (a, aName, b, bName) => {
      if (!norm(a) || !norm(b)) return;
      if (copCountryKey(a) !== copCountryKey(b)) bad.push(`${aName} is ${copShortCountry(a)} but ${bName} is ${copShortCountry(b)}`);
    };
    cmp(f["country of destination"], "Country of Destination", f["delivery destination organization country"], "the Delivery Destination address");
    cmp(f["country of origin"], "Country of Origin", f["shipment origin organization country"], "the Shipment Origin address");
    gate("countries", "qr", "Countries match the addresses", !bad.length, bad.join("; ") + ".", "Destination and origin countries match the addresses.", pastQr);
  })();

  /* ---------- 2 · DTRA Program / Compliance Review (DTRA fills these) ---------- */
  const pastReview = stepIdx > COP_STEP_IDX.review;
  // Flagged (amber) during Estimate Preparation, while it can still be fixed;
  // once in Execution it's only noted ("Incomplete") — too late to change in ATLAS.
  const dtraGate = (id, label, met, missDetail, okDetail) => {
    if (!pastReview && met !== true) { add(id, "review", label, "later", "Entered by DTRA during Compliance Review."); return; }
    const late = stepIdx >= COP_STEP_IDX.exec;
    gate(id, "review", label, met, late ? missDetail + " Noted only — past Estimate Preparation." : missDetail, okDetail, late ? "incomplete" : pastReview);
  };
  (function () {
    const n = items.filter((r) => !norm(copInv(r, /^bis\/ddtc/))).length;
    dtraGate("auth", "BIS/DDTC authorization on every line", items.length ? n === 0 : false,
      items.length ? `${n} of ${copPlural(items.length, "line")} blank.` : "No inventory lines.", `All ${copPlural(items.length, "line")}.`);
    // Denied Party Screen result isn't checked — the field isn't used.
  })();

  /* ---------- 3 · Estimate ---------- */
  const inTtiPrep = si.low === "tti estimate preparation";
  const pastPrep = stepIdx > COP_STEP_IDX.estimate || (stepIdx === COP_STEP_IDX.estimate && !inTtiPrep);
  const compApproved = oldestOf("dtra compliance review (approved)");
  (function () {
    const label = "RFQ sent within 1 business day";
    const rule = "1 business day after both Compliance approval and the pack date";
    if (!compApproved) { add("rfq", "estimate", label, stepIdx < COP_STEP_IDX.estimate ? "later" : "unknown", `Due ${rule}.`); return; }
    if (!trk) { add("rfq", "estimate", label, ms.na ? "na" : "unknown", ms.why); return; }
    const sent = copIsoToDate(trk.rfq);
    if (!sent && norm(trk.rfq)) { add("rfq", "estimate", label, "na", `RFQ Sent Date shows "${trk.rfq}" — no RFQ needed.`); return; }
    if (!sent && sc.handCarry) { add("rfq", "estimate", label, "na", "Hand carry — no RFQ."); return; }
    const packed = copIsoToDate(trk.packed);
    const start = packed && packed.getTime() > compApproved.getTime() ? packed : compApproved;
    const due = packed ? xtWorkday(start, 1, true) : null;
    if (sent) {
      // Sent after the 1-business-day window = a missed metric, flagged while the shipment is still open
      // (user, 2026-11-22) — the same call the Closed audit makes. Acknowledge or [RELIEF: RFQ] clears it.
      const late = !!due && sent.getTime() > due.getTime();
      add("rfq", "estimate", label, late ? "fail" : "ok",
        late ? `Sent ${copFmt(sent)}, after the ${copFmt(due)} due date.` : `Sent ${copFmt(sent)}.`, null,
        late ? `RFQ sent late (${copFmt(sent)}, due ${copFmt(due)})` : undefined);
    } else if (pastPrep) {
      // Past Estimate Preparation, so the RFQ went out — the record is missing its date. Flag it so it gets fixed.
      add("rfq", "estimate", label, "warn", "RFQ Sent Date is blank in ATLAS. The request is past Estimate Preparation, so the record needs it.", null, "RFQ Sent Date missing in ATLAS");
    } else if (!packed) {
      add("rfq", "estimate", label, stepIdx === COP_STEP_IDX.estimate ? "todo" : "later", `Waiting on the pack date (weights/dims from the warehouse). Due ${rule}.`);
    } else if (today.getTime() > due.getTime()) {
      add("rfq", "estimate", label, "fail", `Not sent — was due ${copFmt(due)}.`, null, `RFQ not sent (due ${copFmt(due)})`);
    } else {
      add("rfq", "estimate", label, stepIdx === COP_STEP_IDX.estimate ? "todo" : "later", `Due ${copFmt(due)}.`);
    }
  })();
  // Date Packed: needed by the time the request leaves Estimate Preparation (it starts the RFQ clock).
  if (!sc.handCarry) (function () {
    const label = "Date Packed entered";
    if (!trk) { add("packed", "estimate", label, ms.na ? "na" : "unknown", ms.why); return; }
    const packed = copIsoToDate(trk.packed);
    if (packed) add("packed", "estimate", label, "ok", `Packed ${copFmt(packed)}.`);
    else if (pastPrep) add("packed", "estimate", label, "warn", "Date Packed is blank in ATLAS. The request is past Estimate Preparation, so the record needs it.", null, "Date Packed missing in ATLAS");
    else add("packed", "estimate", label, stepIdx === COP_STEP_IDX.estimate ? "todo" : "later", "Enter it once the cargo is packed — it starts the RFQ clock.");
  })();
  // Total Cost (auto-calculated from the Cost List) above $0 before DTRA
  // Estimate Review — $0 means something was probably missed in the Cost List.
  (function () {
    const total = toFloat(f["total cost in usd"]);
    gate("totalcost", "estimate", "Total Cost above $0 before DTRA Estimate Review", total > 0,
      "Total Cost is $0 or blank — something is probably missing from the Cost List.", `Total ${copMoney(total)}.`, pastPrep);
  })();
  const docsNa = sc.handCarry || sc.category === "DOMESTIC";
  gate("civ", "estimate", "Draft CIV uploaded", docsNa ? "na" : hasType(COP_DOC_TYPES.civAny),
    "No Commercial Invoice (draft or final) attached.", docsNa ? "Not needed (hand carry / domestic)." : "Attached.", pastPrep, ["cop.civ", "docs"]);
  gate("pl", "estimate", "Packing List uploaded", docsNa ? "na" : hasType(["Packing List", "Packing Slips", "IPC"]),
    "No Packing List attached.", docsNa ? "Not needed (hand carry / domestic)." : "Attached.", pastPrep, ["cop.pl", "docs"]);

  /* ---------- 4 · Execution ---------- */
  const inExec = si.step === "exec";
  if (!sc.handCarry) {
    const awbNo = norm(xrow.tracking_awb), carrier = norm(xrow.tracking_carrier);
    const miss = [!carrier && "carrier", !awbNo && "AWB/BoL #"].filter(Boolean);
    gate("tracking", "exec", "Carrier and AWB/BoL # in Shipping Activity", !miss.length,
      `Missing ${miss.join(" and ")}.`, `${carrier} · ${awbNo}.`, moving, ["cop.tracking", "tracking"]);
  }
  // AES filing (ITN) — every US export except hand carry. Filing deadlines
  // (15 CFR 30.4): sealift 24 hours before the cargo is loaded; air 2 hours
  // before departure (8 for USML items); truck 1 hour before reaching the
  // border. At day level: sealift = the day before "Departure from Origin Est.
  // Date", everything else = that date. The ITN is the ATLAS field
  // "ITN / NOEEI Citation" (Shipping Activity).
  if (sc.category === "EXPORT" && !sc.handCarry) (function () {
    const label = "AES filed (ITN)";
    const depAct = xtParseDate(rec.ship["departure from origin act. date"]);
    const etd = xtParseDate(rec.ship["departure from origin est. date"]);
    const left = !!depAct || moving;
    // USML lines: "USML …", "Cat XI(a)", "XI(a)(3)" in the ECCN/USML field.
    const usml = items.some((r) => /usml|^\s*(cat(egory)?\.?\s*)?[ivx]+\s*\(/i.test(copInv(r, /^eccn/)));
    const rule = sc.ocean ? "24 hours before the cargo is loaded" : /truck|ground/i.test(sc.as + " " + (f["requested mode of transit"] || ""))
      ? `${usml ? "8 hours" : "1 hour"} before the truck reaches the border` : `${usml ? "8 hours" : "2 hours"} before departure`;
    const deadline = etd ? (sc.ocean ? xtAddDays(etd, -1) : etd) : null;
    const itn = trk ? norm(trk.itn) : "";
    if (itn) {
      const filed = /^\d{4}-\d{2}-\d{2}$/.test(itn) ? copIsoToDate(itn) : null;
      add("itn", "exec", label, "ok", filed ? `ITN filed ${copFmt(filed)}.` : `${/^x\d/i.test(itn) ? "ITN" : "Exemption / citation"}: ${itn}.`); return;
    }
    if (!trk) { add("itn", "exec", label, ms.na ? "na" : inExec ? "unknown" : "later", `US export — AES must be filed ${rule}. ${ms.why}`); return; }
    if (left) { add("itn", "exec", label, "fail", `Departed without an ITN${depAct ? ` (left origin ${copFmt(depAct)})` : ""}.`, null, "Departed without an ITN"); return; }
    if (!inExec) { add("itn", "exec", label, "later", `US export — AES must be filed ${rule}.`); return; }
    if (!deadline) { add("itn", "exec", label, "todo", `US export — AES must be filed ${rule}; no "Departure from Origin Est. Date" yet.`); return; }
    const d = copCalDays(today, deadline);
    if (d < 0) add("itn", "exec", label, "fail", `Filing deadline ${copFmt(deadline)} (${rule}) has passed with no ITN.`, null, `AES deadline passed (${copFmt(deadline)})`);
    else if (d <= 2) add("itn", "exec", label, "warn", `File by ${copFmt(deadline)} (${rule}); no ITN yet.`, null, `AES due ${copFmt(deadline)}`);
    else add("itn", "exec", label, "todo", `File by ${copFmt(deadline)} (${rule}).`);
  })();
  // MARAD — sealift, due after loading.
  if (sc.ocean) (function () {
    const label = "MARAD report (sealift)";
    const loaded = xtParseDate(rec.ship["departure from origin act. date"]);
    const days = sc.originUs ? COP_MARAD_WORKDAYS_US : COP_MARAD_WORKDAYS_FOREIGN;
    const due = loaded ? xtWorkday(loaded, days, true) : null;
    const sub = trk ? copIsoToDate(trk.maradSub) : null;
    if (sub) { add("marad", "exec", label, "ok", `Submitted ${copFmt(sub)}.`); return; }
    if (trk && /^n\/?a$/i.test(trk.maradSub)) { add("marad", "exec", label, "na", "MARAD Submitted Date shows N/A."); return; }
    if (!loaded) { add("marad", "exec", label, "later", `Due ${days} working days after departure from origin.`); return; }
    if (!trk) { add("marad", "exec", label, ms.na ? "na" : "unknown", `Due ${copFmt(due)}. ${ms.why}`); return; }
    const d = copCalDays(today, due);
    add("marad", "exec", label, d < 0 ? "fail" : d <= COP_DUE_SOON_DAYS ? "warn" : "todo",
      d < 0 ? `Was due ${copFmt(due)}; not submitted.` : `Due ${copFmt(due)} (${days} working days after departure).`,
      null, d < 0 ? `MARAD overdue (due ${copFmt(due)})` : `MARAD due ${copFmt(due)}`);
  })();

  // Relieved of daily updates: nothing counts as missed or due (bubble badge, tiles).
  if (copReliefHit(relief, ["activity"])) { daily.missed = []; daily.dueToday = false; }
  const counts = { red: 0, amber: 0, todo: 0 };
  for (const c of checks) {
    if (c.state === "fail") counts.red++;
    else if (c.state === "warn") counts.amber++;
    else if (c.state === "todo") counts.todo++;
  }
  const latest = rec.daily.length ? rec.daily.slice().sort((a, b) => b.date - a.date)[0] : null;
  const consol = rec.linked.filter((l) => /consol/i.test(l["linkage type"] || "")).map((l) => xtWmtrNumber(l["request number"]))
    .filter((n) => n !== Number.MAX_SAFE_INTEGER);
  return {
    rec, wmtr: rec.wmtr, reqNo: rec.reqNo, num: rec.num, last5: wmtrLast5(rec.wmtr) || String(rec.num),
    poc: f["tti poc name"] || "", title: f["request title"] || "", program: f["ctr program"] || "",
    pocEmail: f["tti poc email"] || "", pocPhone: f["tti poc phone number"] || "", requestor: f["requestor name"] || "",
    status: si.status, step: si.step, stepIdx, phase: si.phase, sub: si.sub, problem: si.problem, unmapped: si.unmapped,
    daysInStep: si.stepSince ? copBizDaysBetween(si.stepSince, today) : null, stuck: stuckState,
    statusSince: copRunSince(rec.wfl, (b) => b === copBaseStatus(si.status)),
    rdd, rddDays: rdd && !delivered ? copCalDays(today, rdd) : null,
    dest: copShortCountry(f["country of destination"] || ""), origin: copShortCountry(f["country of origin"] || ""),
    mode: sc.as || f["requested mode of transit"] || "",
    latest, daily, carrier: xrow.tracking_carrier, awb: xrow.tracking_awb, tracklink: xrow.tracking_link, trk,
    consol, checks, counts, relief: relief.list, rddWatch, health: counts.red ? "red" : counts.amber ? "amber" : "green",
  };
}

/** Evaluate every record: active rows (new engine) + closed rows (audit engine). */
function copBuildAll() {
  const data = copData();
  if (!data) return null;
  // Pending daily updates entered on the COP (mockup / preview only).
  const drafts = copLocalUpdates() ? copPruneDrafts(data.records) : {};
  const ctx = {
    today: copToday(), prefs: copGetPrefs(), ds: data.ds,
    ignores: typeof xtGetIgnores === "function" ? xtGetIgnores() : {}, drafts,
  };
  const active = [], closed = [];
  for (const rec of data.records) {
    const low = copLow(rec.f["status"]);
    if (low === "deleted" || /^draft\b/.test(low)) continue;
    try {
      if (copIsClosedStatus(low)) {
        const r = copEvaluate(rec, ctx);
        r.health = r.counts.red ? "red" : r.counts.amber ? "amber" : "green";
        closed.push(r);
      } else {
        const r = copActiveEvaluate(rec, ctx);
        if (r) { r.pending = drafts[rec.wmtr] || []; active.push(r); }
      }
    } catch (e) { console.error("COP: couldn't evaluate", rec.wmtr, e); }
  }
  return { active, closed, ctx, ds: data.ds };
}

/* -------------------------------------------------------------------------
   FILTERS
   ------------------------------------------------------------------------- */
/* KPI-tile quick filters (In progress view). */
const COP_QUICK_DAYS = 7;                 // "departing" window
function copDepartingSoon(r) {
  if (r.step !== "exec" || COP_PHASE_IDX[r.phase] >= COP_PHASE_IDX.transit) return false;
  const ship = (r.rec && r.rec.ship) || {};
  if (xtParseDate(ship["departure from origin act. date"])) return false;     // already left
  const etd = xtParseDate(ship["departure from origin est. date"]);
  return !!etd && copCalDays(copToday(), etd) <= COP_QUICK_DAYS;              // includes an ETD already passed
}
const COP_QUICK = {
  due: (r) => r.daily && r.daily.dueToday,
  missed: (r) => r.daily && r.daily.missed && r.daily.missed.length > 0,
  departing: copDepartingSoon,
  // RFQ can go out now (packed + Compliance approved) or is overdue.
  rfq: (r) => r.checks.some((c) => c.id === "rfq" && (c.state === "fail" || (c.state === "todo" && /^Due /.test(c.detail)))),
  // US export in Execution with no ITN / NOEEI citation yet.
  eei: (r) => r.step === "exec" && r.checks.some((c) => c.id === "itn" && (c.state === "fail" || c.state === "warn" || c.state === "todo")),
};
function copTodayStrip(base) {
  const n = (f) => base.filter(f).length;
  const att = n((r) => r.counts.red || r.counts.amber);
  // A tile that reads zero isn't shown (less on screen) — except "In progress", and one that's currently the filter.
  const tile = (key, tone, count, label, hint, on) => (!count && !on && key) ? "" : `<button type="button" class="copx-kpi ${tone} ${on ? "on" : ""} ${count ? "" : "zero"}" data-quick="${key}" ${count || on ? "" : "disabled"} aria-pressed="${!!on}" title="${esc(hint)}">
      <span class="n">${count}</span><span class="l">${esc(label)}</span></button>`;
  return el(`<div class="copx-kpis copx-today" role="group" aria-label="Today — click a tile to filter">
    ${tile("", "", base.length, "In progress", "Every active shipment", !CopUi.quick && !CopUi.atRisk)}
    ${tile("attention", "a", att, "Need attention", "Something is missed or needs action", CopUi.atRisk)}
    ${tile("due", "p", n(COP_QUICK.due), "Updates due today", "Today's daily update isn't in yet", CopUi.quick === "due")}
    ${tile("missed", "r", n(COP_QUICK.missed), "Missed updates", "A business day with no daily update", CopUi.quick === "missed")}
    ${tile("rfq", "b", n(COP_QUICK.rfq), "RFQs to send", "Compliance approved and packed — RFQ due within 1 business day", CopUi.quick === "rfq")}
    ${tile("eei", "t", n(COP_QUICK.eei), "EEI to file", "US exports in Execution with no ITN / NOEEI citation yet", CopUi.quick === "eei")}
  </div>`);
}

function copFilterRows(all) {
  let rows = all;
  if (CopUi.poc) rows = rows.filter((r) => copLow(r.poc) === copLow(CopUi.poc));
  if (CopUi.q) {
    const q = copLow(CopUi.q);
    rows = rows.filter((r) => copLow(r.wmtr + " " + r.title + " " + r.dest + " " + r.poc + " " + r.status).includes(q));
  }
  const base = rows;                       // before attention / hit filters (board counts)
  if (CopUi.atRisk) rows = rows.filter((r) => r.counts.red || r.counts.amber);
  if (CopUi.quick && CopUi.view !== "closed") rows = rows.filter(COP_QUICK[CopUi.quick] || (() => true));
  if (CopUi.hit) rows = rows.filter((r) => r.checks.some((c) => c.id === CopUi.hit && (c.state === "fail" || c.state === "warn" || c.state === "due")));
  if (CopUi.rddDays === -1) rows = rows.filter((r) => r.rddDays !== null && r.rddDays < 0);          // Past RDD
  else if (CopUi.rddDays) rows = rows.filter((r) => r.rddDays !== null && r.rddDays >= 0 && r.rddDays <= CopUi.rddDays);
  rows = copApplyColFilters(rows, CopUi.view !== "closed");
  return { base, rows };
}

/* -------------------------------------------------------------------------
   VIEW — ATLAS styling (Poppins, navy / ATLAS blue, white cards, blue table
   headers, light-blue Filter bar), so it can move into the ATLAS WMTR
   dashboard as-is.
   ------------------------------------------------------------------------- */
const COPX_CSS = `
.copx{--ax-navy:#1e2a4a;--ax-ink:#1f2d3d;--ax-ink2:#3c4858;--ax-muted:#5a6778;--ax-line:#d6dde8;--ax-line2:#e3e8ef;
  --ax-card:#fff;--ax-soft:#f3f5f9;--ax-acc:#e3f0fc;--ax-acc2:#f0f7ff;--ax-link:#1565c0;--ax-blue:#1e5aa8;--ax-blue-soft:#e3edf9;
  --ax-th:#6d9ad0;--ax-green:#2e7d32;--ax-green-soft:#eaf5ec;--ax-amber:#c65d00;--ax-amber-soft:#fff1e3;--ax-red:#c62828;--ax-red-soft:#fdecea;--ax-purple:#6a3fb5;--ax-purple-soft:#e1d2fa;--ax-teal:#00838f;--ax-neutral:#aab4c3;
  --ax-go:#22683a;--ax-reset:#4a7ab8;--ax-grey:#b5bcc6;
  font-family:Poppins,"Segoe UI",system-ui,sans-serif;color:var(--ax-ink);font-size:13px;display:flex;flex-direction:column;gap:16px}
body.theme-dark .copx{--ax-ink:#e6ebf2;--ax-ink2:#c4ccd8;--ax-muted:#9aa7b8;--ax-line:#33414f;--ax-line2:#2a3744;--ax-card:#17212c;
  --ax-soft:#121a23;--ax-acc:#1d2c3d;--ax-acc2:#1a2736;--ax-link:#7fb2ef;--ax-blue-soft:#1d2c3d;--ax-green-soft:#16281b;--ax-amber-soft:#2e2112;--ax-red-soft:#2e1617;--ax-purple:#b79cf0;--ax-purple-soft:#2c2142;--ax-teal:#4dd0e1;--ax-neutral:#4a5868}
.copx *{box-sizing:border-box}
.copx button,.copx input,.copx select{font-family:inherit}
.copx-tabs{display:flex;gap:4px;border-bottom:2px solid var(--ax-line);margin-top:-4px}
.copx-tabs button{border:0;background:transparent;color:var(--ax-muted);padding:9px 16px 8px;font-weight:600;font-size:13px;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px}
.copx-tabs button.on{color:var(--ax-blue);border-bottom-color:var(--ax-blue)}
.copx-tabs button:hover:not(.on){color:var(--ax-ink)}
.copx-card{background:var(--ax-card);border-radius:10px;box-shadow:0 1px 3px rgba(20,30,60,.14);padding:18px 22px 20px}
.copx-hd{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.copx-hd h2{margin:0;font-size:18px;font-weight:600;color:var(--ax-ink)}
.copx-hd .n{font-size:12px;color:var(--ax-muted)}
.copx-hd .acts{margin-left:auto;display:flex;gap:8px}
.copx-rule{height:2px;background:#9fbbe0;margin:10px 0 14px;opacity:.7}
.copx-btn{border:0;border-radius:6px;padding:8px 18px;min-height:36px;font-weight:600;font-size:13px;cursor:pointer;color:#fff;background:var(--ax-grey)}
.copx-btn.blue{background:var(--ax-reset)} .copx-btn.green{background:var(--ax-go)}
.copx-btn.ghost{background:transparent;color:var(--ax-link);border:1.5px solid var(--ax-link)}
.copx-btn:hover{filter:brightness(.95)}
.copx-frow{display:grid;grid-template-columns:minmax(170px,1fr) minmax(220px,1.5fr) minmax(200px,1.3fr) auto auto;gap:12px;align-items:end;margin-bottom:12px}
@media (max-width:1000px){.copx-frow{grid-template-columns:1fr 1fr}}
@media (max-width:560px){.copx-frow{grid-template-columns:1fr}}
.copx-filter{background:var(--ax-acc);border-radius:6px;margin-bottom:16px}
.copx-filter>summary{list-style:none;cursor:pointer;padding:10px 18px;font-weight:600;color:var(--ax-link);display:flex;align-items:center}
.copx-filter>summary::-webkit-details-marker{display:none}
.copx-filter>summary .chev{transition:transform .15s}
.copx-filter[open]>summary .chev{transform:rotate(180deg)}
.copx-filter .fbody{padding:4px 18px 16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;align-items:end}
.copx-f label{display:block;font-size:12px;font-weight:600;color:var(--ax-ink);margin-bottom:4px}
.copx-f select,.copx-f input[type=search]{width:100%;border:1px solid #c9d2de;border-radius:6px;padding:8px 10px;min-height:38px;background:var(--ax-card);color:var(--ax-ink);font-size:12.5px}
.copx-chk{display:flex;align-items:center;gap:7px;font-size:12.5px;min-height:38px;cursor:pointer}
.copx-fbtns{display:flex;gap:8px;flex-wrap:wrap}
.copx-sub{grid-column:1 / -1;display:flex;gap:10px 18px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--ax-ink2);border-top:1px solid #c8dcf0;padding-top:10px}
.copx-sub .lnk,.copx-limits .lnk{border:0;background:none;color:var(--ax-link);font-weight:600;cursor:pointer;padding:0;text-decoration:underline;font-size:12px}
.copx-limits{grid-column:1 / -1;display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:6px 18px;font-size:12px}
.copx-limits input{width:56px;border:1px solid #c9d2de;border-radius:5px;padding:3px 6px;margin:0 4px;background:var(--ax-card);color:var(--ax-ink)}
/* board */
.copx-board{display:grid;grid-template-columns:1fr 1fr 1fr 2.2fr;gap:14px;align-items:stretch}
@media (max-width:1250px){.copx-board{grid-template-columns:1fr 1fr 1fr}.copx-col.exec{grid-column:1 / -1}}
@media (max-width:760px){.copx-board{grid-template-columns:1fr}}
.copx-col{border:1px solid var(--ax-line);border-radius:10px;background:var(--ax-soft);display:flex;flex-direction:column;min-width:0}
.copx-col .ch{position:relative;background:var(--ax-navy);color:#fff;border-radius:9px 9px 0 0;padding:10px 64px 10px 14px;min-height:62px;display:flex;flex-direction:column;justify-content:center}
.copx-col .ch .t{font-weight:600;font-size:13.5px;line-height:1.25}
.copx-col .ch .s{font-size:11px;opacity:.85}
.copx-col .ch .cnt{position:absolute;right:11px;top:50%;transform:translateY(-50%);width:42px;height:42px;border-radius:50%;background:#fff;color:var(--ax-navy);
  font-size:18px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 3px rgba(255,255,255,.35)}
.copx-col .tally{display:flex;gap:10px;flex-wrap:wrap;padding:7px 12px;font-size:11.5px;color:var(--ax-ink2);border-bottom:1px solid var(--ax-line2);background:var(--ax-card)}
.copx-col .tally b{font-weight:700}
.copx-col .tally .r{color:var(--ax-red)} .copx-col .tally .a{color:var(--ax-amber)} .copx-col .tally .g{color:var(--ax-muted)}
.copx-col .cb{padding:12px;display:flex;flex-wrap:wrap;gap:9px 7px;align-content:flex-start;flex:1}
.copx-col.exec .cb{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.copx-col .cb.subs{display:flex;flex-direction:column;flex-wrap:nowrap;gap:10px}
.copx-ph{background:var(--ax-card);border:1px solid var(--ax-line2);border-radius:8px;padding:8px 9px 10px}
.copx-ph .pl{font-size:10.5px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--ax-muted);margin-bottom:7px;display:flex;justify-content:space-between}
.copx-ph .bb{display:flex;flex-wrap:wrap;gap:9px 7px}
.copx-empty{font-size:12px;color:var(--ax-muted);font-style:italic}
.copx-bub{height:26px;min-width:56px;padding:0 9px;border-radius:13px;border:2px solid var(--ax-neutral);background:var(--ax-card);color:var(--ax-ink);
  font-weight:600;font-size:12px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;position:relative;
  transition:transform .1s, box-shadow .1s}
.copx-bub:hover,.copx-bub:focus-visible{transform:scale(1.06);box-shadow:0 0 0 3px rgba(30,90,168,.22);outline:none}
.copx-bub.amber{border-color:var(--ax-amber);background:var(--ax-amber-soft)}
.copx-bub.red{border-color:var(--ax-red);background:var(--ax-red-soft);color:var(--ax-red)}
.copx-bub.due{background:var(--ax-purple-soft);color:var(--ax-purple);font-weight:700}     /* only today's update outstanding */
.copx-bub.sel{box-shadow:0 0 0 3px var(--ax-blue)}
.copx-bub .cl{display:inline-flex;margin-left:4px;color:var(--ax-teal)}
.copx-bub .bang,.copx-bub .nd{position:absolute;top:-8px;right:-8px;min-width:16px;height:16px;border-radius:8px;background:var(--ax-red);color:#fff;font-size:9.5px;line-height:16px;padding:0 4px;font-weight:700;text-align:center}
.copx-legend{display:flex;gap:18px;flex-wrap:wrap;margin-top:12px;font-size:11.5px;color:var(--ax-ink2)}
.copx-legend span{display:inline-flex;align-items:center;gap:6px}
.copx-legend i{width:24px;height:13px;border-radius:7px;border:2px solid var(--ax-neutral);background:var(--ax-card);display:inline-block}
.copx-legend i.p{background:var(--ax-purple-soft)} .copx-legend .cl{color:var(--ax-teal);display:inline-flex} .copx-legend i.a{border-color:var(--ax-amber);background:var(--ax-amber-soft)} .copx-legend i.r{border-color:var(--ax-red);background:var(--ax-red-soft)}
.copx-legend em{font-style:normal;background:var(--ax-red);color:#fff;border-radius:9px;padding:0 5px;font-size:10px;font-weight:600}
/* table */
.copx-tbl{overflow:auto;max-height:720px;border-radius:6px}
.copx-tbl table{width:100%;border-collapse:collapse;font-size:12.5px}
.copx-tbl th{position:sticky;top:0;z-index:1;background:var(--ax-th);color:#fff;text-align:left;font-weight:600;padding:12px 12px;white-space:nowrap;border-right:1px solid rgba(255,255,255,.25)}
.copx-tbl td{padding:10px 12px;border-bottom:1px solid var(--ax-line2);vertical-align:top}
.copx-tbl th.srt{cursor:pointer;user-select:none}
.copx-tbl th.srt:hover,.copx-tbl th.srt.on{background:var(--ax-blue)}
.copx-tbl th .ar{font-size:9px;margin-left:3px}
.copx-tbl tr.flt th{background:var(--ax-soft);padding:5px 6px;border-bottom:1px solid var(--ax-line);border-right:1px solid var(--ax-line2)}
.copx-tbl .copx-cf{width:100%;min-width:70px;font:inherit;font-size:11.5px;font-weight:400;padding:4px 6px;border:1px solid var(--ax-line);border-radius:4px;background:var(--ax-card);color:var(--ax-ink)}
.copx-colpick{display:flex;flex-wrap:wrap;gap:12px 32px;background:var(--ax-soft);border:1px solid var(--ax-line);border-radius:8px;padding:12px 14px;margin-bottom:12px}
.copx-colpick>div{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center}
.copx-colpick .k{width:100%;font-size:10.5px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--ax-muted)}
.copx-colpick .ft{width:100%}
.copx-colpick .lnk{border:0;background:none;color:var(--ax-link);font-weight:600;cursor:pointer;padding:0;text-decoration:underline;font-size:12px}
.copx-tbl tr.row{cursor:pointer}
/* Doc Check */
.copx-dc-hd{display:flex;flex-wrap:wrap;gap:12px 18px;align-items:flex-end;margin-bottom:14px}
.copx-dc-hd .copx-chk{margin-bottom:8px}
.copx-dc-sumline{margin:0 0 8px auto;font-size:12.5px;color:var(--ax-ink2)}
.copx-dc-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:10px;margin-bottom:14px}
.copx-dc-card{border:1px solid var(--ax-line);border-radius:10px;background:var(--ax-soft);padding:10px 12px}
.copx-dc-card .k{font-size:11px;font-weight:600;letter-spacing:.4px;color:var(--ax-muted);text-transform:uppercase}
.copx-dc-card .n{font-size:24px;font-weight:700;color:var(--ax-navy);line-height:1.2}
.copx-dc-card .s{font-size:11.5px;color:var(--ax-ink2)}
.copx-dc-t td.dc{text-align:center;font-weight:600}
.copx-dc-t th:nth-child(n+4){text-align:center}
.copx-dc-t td.dc.x{color:var(--ax-green)} .copx-dc-t td.dc.na,.copx-dc-t td.dc.unk{color:var(--ax-muted);font-weight:400}
.copx-dc-t td.dc.miss{color:var(--ax-red);background:var(--ax-red-soft)}
.copx-dc-legend{margin-top:8px;font-size:11.5px;color:var(--ax-muted)}
.copx-tbl td.aud div{font-size:12px;font-weight:600;line-height:1.35;margin-bottom:2px;white-space:nowrap}
.copx-tbl tr.row:hover td{background:var(--ax-acc2)}
.copx-tbl tr.row.sel td{background:var(--ax-blue-soft)}
.copx-tbl .w{font-weight:600;white-space:nowrap}
.copx-tbl .w small{display:block;font-weight:400;font-size:10.5px;color:var(--ax-muted)}
.copx-tbl .st small{display:block;color:var(--ax-muted);font-size:11px}
.copx-tbl .up{max-width:340px}
.copx-tbl .up .d{font-size:11px;color:var(--ax-muted)}
.copx-tbl .up .x{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.copx-tbl .nw{white-space:nowrap}
.copx-dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--ax-green);margin-right:6px;vertical-align:0}
.copx-dot.amber{background:var(--ax-amber)} .copx-dot.red{background:var(--ax-red)}
.copx-pill{display:inline-block;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:600;white-space:nowrap;margin:0 3px 2px 0}
.copx-pill.r{background:var(--ax-red-soft);color:var(--ax-red)} .copx-pill.a{background:var(--ax-amber-soft);color:var(--ax-amber)}
.copx-pill.g{background:var(--ax-green-soft);color:var(--ax-green)} .copx-pill.p{background:var(--ax-purple-soft);color:var(--ax-purple)} .copx-pill.t{background:transparent;border:1px solid var(--ax-teal);color:var(--ax-teal)}
.copx-pill.b{background:var(--ax-blue-soft);color:var(--ax-blue)}
.copx-red{color:var(--ax-red);font-weight:600} .copx-amber{color:var(--ax-amber);font-weight:600}
/* detail */
tr.copx-det td{background:var(--ax-acc2);padding:14px 16px 18px}
.copx-det-grid{display:grid;grid-template-columns:minmax(220px,290px) minmax(0,1fr) minmax(240px,330px);gap:16px;align-items:start}
@media (max-width:1150px){.copx-det-grid{grid-template-columns:minmax(200px,260px) minmax(0,1fr)}.copx-det-grid>:last-child{grid-column:2}}
@media (max-width:760px){.copx-det-grid{grid-template-columns:1fr}.copx-det-grid>:last-child{grid-column:auto}}
.copx-watch{min-height:0;margin-top:4px;font-size:11.5px;align-items:flex-start}
.copx-info{font-size:12px;display:flex;flex-direction:column;gap:8px}
.copx-info .k{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--ax-muted)}
.copx-info .log div{padding:2px 0}
.copx-info .log span{color:var(--ax-muted);margin-right:6px;font-size:11px}
.copx-steps{display:flex;flex-direction:column;gap:10px;min-width:0}
.copx-stp{background:var(--ax-card);border:1px solid var(--ax-line);border-radius:8px;overflow:hidden}
.copx-stp h4{margin:0;padding:8px 12px;font-size:12.5px;font-weight:600;background:var(--ax-acc);color:var(--ax-ink);display:flex;justify-content:space-between;gap:8px}
.copx-stp.cur h4{background:var(--ax-blue);color:#fff}
.copx-stp ul{list-style:none;margin:0;padding:4px 0}
.copx-stp li{display:grid;grid-template-columns:18px 1fr auto;gap:2px 8px;padding:5px 12px;font-size:12px;align-items:start}
.copx-stp li .ic{font-weight:700;text-align:center}
.copx-stp li .lb{font-weight:600}
.copx-stp li .dt{grid-column:2 / 4;color:var(--ax-muted);font-size:11.5px}
.copx-stp li.s-good .ic{color:var(--ax-green)}
.copx-stp li.s-bad{background:var(--ax-red-soft)} .copx-stp li.s-bad .ic{color:var(--ax-red)}
.copx-stp li.s-warn{background:var(--ax-amber-soft)} .copx-stp li.s-warn .ic{color:var(--ax-amber)}
.copx-stp li.s-open .ic,.copx-stp li.s-todo .ic{color:var(--ax-blue)}
.copx-stp li.s-late .ic,.copx-stp li.s-incomplete .ic{color:var(--ax-muted)} .copx-stp li.s-late .lb,.copx-stp li.s-incomplete .lb{color:var(--ax-ink2)}
.copx-stp li.s-na,.copx-stp li.s-ack{color:var(--ax-muted)} .copx-stp li.s-na .lb,.copx-stp li.s-ack .lb{font-weight:400}
.copx-ack{border:1px solid var(--ax-line);background:var(--ax-card);color:var(--ax-muted);border-radius:12px;cursor:pointer;font-size:10.5px;padding:1px 8px;white-space:nowrap}
.copx-ack:hover{border-color:var(--ax-link);color:var(--ax-link)}
.copx-msg{font-size:12px;color:var(--ax-ink2)}
.copx-tabs{align-items:flex-end}
.copx-role{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ax-muted);padding-bottom:6px}
.copx-seg{display:inline-flex;border:1px solid var(--ax-line);border-radius:8px;overflow:hidden;background:var(--ax-card)}
.copx-seg button{border:0;background:transparent;color:var(--ax-ink2);padding:6px 12px;font-weight:600;font-size:12px;cursor:pointer}
.copx-seg button.on{background:var(--ax-navy);color:#fff}
.copx-btn.sm{padding:5px 12px;min-height:30px;font-size:12px}
.copx-btn.addb{background:#1e88e5}
.copx-in{width:100%;border:1px solid #c9d2de;border-radius:6px;padding:7px 9px;background:var(--ax-card);color:var(--ax-ink);font:inherit;font-size:12.5px}
textarea.copx-in{resize:vertical;min-height:40px}
.copx-uform{background:var(--ax-card);border:1px solid var(--ax-line);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:7px}
.copx-uform .k.g{color:var(--ax-green);font-weight:600;text-transform:none;letter-spacing:0;font-size:12.5px}
.copx-uform .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.copx-uform .row input[type=date]{width:auto;flex:1}
.copx-uform .lnk,.copx-sheet .lnk,.copx-info .lnk{border:0;background:none;color:var(--ax-link);font-weight:600;cursor:pointer;padding:0;text-decoration:underline;font-size:12px}
a.copx-open{font-weight:inherit;text-decoration:underline;color:var(--ax-link);white-space:nowrap}
a.copx-open:hover{text-decoration:underline}
.copx-sheet-hd{display:flex;gap:10px 16px;align-items:center;flex-wrap:wrap;margin-bottom:10px;font-size:12.5px}
.copx-sheet-hd label{display:flex;align-items:center;gap:8px;font-weight:600}
.copx-sheet-hd input{width:auto}
.copx-sheet tr.done td{background:var(--ax-green-soft)}
.copx-sheet td{vertical-align:top}
.copx-sheet .copx-donebox{font-size:12px;color:var(--ax-green);margin-bottom:5px}
.copx-sheet td .copx-btn{margin:0 4px 4px 0}
.copx-sheet-ft{display:flex;justify-content:flex-end;padding-top:10px}
.copx-modal-bg{position:fixed;inset:0;background:rgba(30,42,74,.55);display:flex;align-items:center;justify-content:center;padding:24px;z-index:10000}
.copx-modal{background:var(--ax-card);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);width:min(1000px,100%);max-height:calc(100vh - 48px);display:flex;flex-direction:column;overflow:hidden;padding:14px}
.copx-modal-hd{display:flex;justify-content:space-between;align-items:center;background:var(--ax-navy);color:#fff;border-radius:8px;padding:12px 16px;margin-bottom:12px;font-weight:600;font-size:16px}
.copx-modal-hd .x{border:0;background:transparent;color:#fff;font-size:22px;cursor:pointer;line-height:1}
.copx-bub.neutral{border-color:var(--ax-blue);background:var(--ax-blue-soft);color:var(--ax-blue)}
.copx-frow.req{grid-template-columns:minmax(200px,1fr) minmax(220px,1.4fr) 2fr}
.copx-det-grid.req{grid-template-columns:minmax(240px,340px) minmax(0,1fr)}
.copx-prog{display:flex;flex-wrap:wrap;gap:0;margin:6px 0 12px}
.copx-prog .ps{display:flex;flex-direction:column;align-items:center;gap:4px;flex:1 1 70px;position:relative;font-size:11px;color:var(--ax-muted);text-align:center}
.copx-prog .ps i{width:16px;height:16px;border-radius:50%;background:var(--ax-card);border:2px solid #b8c2cf;z-index:1}
.copx-prog .ps::before{content:"";position:absolute;top:7px;left:-50%;width:100%;height:3px;background:#d3dae3}
.copx-prog .ps:first-child::before{display:none}
.copx-prog .ps.done i{background:var(--ax-blue);border-color:var(--ax-blue)}
.copx-prog .ps.done::before,.copx-prog .ps.cur::before{background:var(--ax-blue)}
.copx-prog .ps.cur i{border:3px solid var(--ax-blue);box-shadow:0 0 0 4px rgba(30,90,168,.18)}
.copx-prog .ps.cur span{color:var(--ax-blue);font-weight:700}
#copHover{position:fixed;z-index:9999;width:340px;max-width:calc(100vw - 16px);background:#fff;color:#1f2d3d;border:1px solid #d6dde8;border-radius:10px;
  box-shadow:0 10px 28px rgba(20,30,60,.22);padding:12px 14px;font:12px/1.45 Poppins,"Segoe UI",system-ui,sans-serif;pointer-events:none;display:none}
#copHover .h{font-weight:700;font-size:13px}
#copHover .s{color:#5a6778;font-size:11.5px;margin-bottom:8px}
#copHover .k{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#5a6778;margin-top:8px}
#copHover .bad{color:#c62828;font-weight:600} #copHover .ok{color:#2e7d32;font-weight:600}
#copHover ul{margin:3px 0 0;padding-left:16px}
#copHover li.r{color:#c62828} #copHover li.a{color:#c65d00}
/* ===== 2.9.0 look — calm white cards, hairline borders, light table headers, KPI tiles.
   Colour is kept for exceptions only. Pilot for the rest of the Utility: these rules
   restyle the classes above, so the new look lives in one block. ===== */
.copx{--ax-radius:14px;--ax-shadow:0 1px 2px rgba(16,24,40,.05),0 1px 3px rgba(16,24,40,.07);--ax-th-bg:#f5f7fa;--ax-line:#e1e6ed;--ax-line2:#edf0f5;--ax-soft:#f7f9fc;--ax-ink:#17233a;--ax-muted:#637083;--ax-neutral:#c3ccd8;
  font-family:Inter,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;gap:18px;font-variant-numeric:tabular-nums}
body.theme-dark .copx{--ax-th-bg:#1b2632;--ax-shadow:none;--ax-navy:#3d5a8c}
/* page header */
.copx-top{display:flex;align-items:center;gap:14px 24px;flex-wrap:wrap}
.copx-top h1{margin:0;font-size:22px;font-weight:650;letter-spacing:-.01em;color:var(--ax-ink);line-height:1.2}
.copx-top .fr{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.copx-top .acts{margin-left:auto;display:flex;gap:8px}
.copx-top .copx-role{margin-left:0;padding:0}
.copx-fresh{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:500;color:var(--ax-ink2);background:var(--ax-card);border:1px solid var(--ax-line);border-radius:999px;padding:3px 11px 3px 9px}
.copx-fresh i{width:8px;height:8px;border-radius:50%;background:var(--ax-neutral);flex:none}
.copx-fresh.ok i{background:var(--ax-green);box-shadow:0 0 0 3px var(--ax-green-soft)}
.copx-fresh.file i{background:var(--ax-blue)}
.copx-fresh.err{color:var(--ax-red);border-color:var(--ax-red)} .copx-fresh.err i{background:var(--ax-red)}
.copx-fresh.busy i{background:var(--ax-amber);animation:copxPulse 1s ease-in-out infinite}
@keyframes copxPulse{50%{opacity:.25}}
@keyframes copxSpin{to{transform:rotate(360deg)}}
/* view switch */
.copx-tabs{display:inline-flex;gap:2px;border:0;margin:0;background:var(--ax-line2);border-radius:11px;padding:3px;align-items:center}
.copx-tabs button{border:0;border-radius:8px;margin:0;padding:7px 14px;font-size:13px;font-weight:600;color:var(--ax-muted);background:transparent;display:inline-flex;align-items:center;gap:7px}
.copx-tabs button.on{background:var(--ax-card);color:var(--ax-ink);box-shadow:var(--ax-shadow)}
.copx-tabs button .c,.copx-seg button .c{font-size:11px;font-weight:600;background:var(--ax-line);color:var(--ax-ink2);border-radius:999px;padding:0 7px;line-height:18px}
.copx-tabs button.on .c{background:var(--ax-blue-soft);color:var(--ax-blue)}
/* buttons */
.copx-ibtn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--ax-line);background:var(--ax-card);color:var(--ax-ink);border-radius:9px;padding:7px 13px;font-size:12.5px;font-weight:600;cursor:pointer}
.copx-ibtn:hover:not(:disabled){border-color:var(--ax-blue);color:var(--ax-blue)} .copx-ibtn:disabled{opacity:.5;cursor:default}
.copx-btn{border-radius:9px;padding:7px 14px;min-height:34px;font-size:12.5px;background:var(--ax-card);color:var(--ax-ink);border:1px solid var(--ax-line)}
.copx-btn.blue{background:var(--ax-navy);border-color:var(--ax-navy);color:#fff}
.copx-btn.green{background:var(--ax-go);border-color:var(--ax-go);color:#fff}
.copx-btn.addb{background:var(--ax-blue);border-color:var(--ax-blue);color:#fff}
.copx-btn.ghost{border:1px solid var(--ax-line);color:var(--ax-ink2)}
.copx-btn:hover{filter:none;border-color:var(--ax-blue)}
/* cards */
.copx-card{border-radius:var(--ax-radius);box-shadow:var(--ax-shadow);border:1px solid var(--ax-line);padding:18px 20px 20px}
.copx-hd{margin-bottom:14px;align-items:baseline}
.copx-hd h2{font-size:15px;font-weight:650}
.copx-rule{display:none}
.copx-banner{background:var(--ax-amber-soft);color:var(--ax-amber);border-radius:10px;padding:9px 12px;font-size:12.5px;font-weight:500;margin-bottom:14px}
.copx-wait{text-align:center;padding:56px 24px}
.copx-wait h2{margin:0 0 6px;font-size:17px;font-weight:650}
.copx-wait .copx-msg{max-width:540px;margin:0 auto 16px}
.copx-spin{width:34px;height:34px;border-radius:50%;border:3px solid var(--ax-line);border-top-color:var(--ax-blue);margin:0 auto 16px;animation:copxSpin .8s linear infinite}
@media (prefers-reduced-motion:reduce){.copx-spin,.copx-fresh.busy i{animation:none}}
/* KPI tiles (each one is a filter) */
.copx-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}
.copx-kpi{position:relative;text-align:left;border:1px solid var(--ax-line);background:var(--ax-card);border-radius:12px;padding:12px 14px 11px 16px;cursor:pointer;display:flex;flex-direction:column;gap:2px;min-width:0;color:var(--ax-ink);font:inherit;transition:border-color .12s,box-shadow .12s,transform .12s}
.copx-kpi::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:3px;border-radius:0 3px 3px 0;background:var(--ax-neutral)}
.copx-kpi .n{font-size:26px;font-weight:650;line-height:1.1;letter-spacing:-.02em}
.copx-kpi .l{font-size:12.5px;font-weight:600}
.copx-kpi .h{font-size:11px;color:var(--ax-muted);line-height:1.35}
.copx-kpi.r::before{background:var(--ax-red)} .copx-kpi.r .n{color:var(--ax-red)}
.copx-kpi.a::before{background:var(--ax-amber)} .copx-kpi.a .n{color:var(--ax-amber)}
.copx-kpi.p::before{background:var(--ax-purple)} .copx-kpi.p .n{color:var(--ax-purple)}
.copx-kpi.b::before,.copx-kpi.n::before{background:var(--ax-blue)} .copx-kpi.b .n,.copx-kpi.n .n{color:var(--ax-blue)}
.copx-kpi.t::before{background:var(--ax-teal)} .copx-kpi.t .n{color:var(--ax-teal)}
.copx-kpi.g::before{background:var(--ax-green)} .copx-kpi.g .n{color:var(--ax-green)}
.copx-kpi.zero::before{background:var(--ax-line)} .copx-kpi.zero .n{color:var(--ax-neutral)}
.copx-kpi:hover:not(:disabled){border-color:var(--ax-blue);box-shadow:var(--ax-shadow);transform:translateY(-1px)}
.copx-kpi.on{border-color:var(--ax-blue);box-shadow:0 0 0 2px var(--ax-blue-soft);background:var(--ax-acc2)}
.copx-kpi:disabled{cursor:default}
/* filters */
.copx-filters{margin-bottom:14px}
.copx-filters .copx-frow,.copx-frow.trk{display:flex;flex-wrap:wrap;gap:10px 12px;align-items:flex-end;margin-bottom:8px}
.copx-frow.trk{margin-bottom:14px}
.copx-filters .copx-frow .copx-f,.copx-frow.trk .copx-f{flex:1 1 180px;max-width:300px}
.copx-filters .copx-frow .copx-f:first-child,.copx-frow.trk .copx-f:first-child{flex:2 1 240px;max-width:420px}
.copx-frow.trk .copx-f:nth-child(3){flex:0 0 auto;max-width:none}
.copx-filters .copx-fbtns,.copx-frow.trk .copx-fbtns{margin-left:auto}
.copx-f label{font-size:11px;font-weight:600;color:var(--ax-muted);text-transform:uppercase;letter-spacing:.04em}
.copx-f select,.copx-f input[type=search]{border-color:var(--ax-line);border-radius:9px;min-height:36px}
.copx-f select:focus,.copx-f input[type=search]:focus{outline:2px solid var(--ax-blue-soft);border-color:var(--ax-blue)}
.copx-chk{min-height:36px}
.copx-filter{background:transparent;margin-bottom:0}
.copx-filter>summary{padding:2px 0;font-size:12px;display:inline-flex}
.copx-filter .fbody{background:var(--ax-soft);border:1px solid var(--ax-line);border-radius:10px;padding:12px 14px;margin-top:6px}
.copx-sub{border-top-color:var(--ax-line)}
.copx-seg{border-color:var(--ax-line);border-radius:9px}
.copx-seg button{display:inline-flex;align-items:center;gap:6px;min-height:34px;white-space:nowrap}
.copx-seg button.on .c{background:rgba(255,255,255,.22);color:#fff}
/* board */
.copx-board{gap:12px}
.copx-col{border-radius:12px;border-color:var(--ax-line);overflow:hidden}
.copx-col .ch{background:var(--ax-card);color:var(--ax-ink);border-radius:0;border-bottom:1px solid var(--ax-line);padding:12px 58px 10px 14px;min-height:58px;box-shadow:inset 0 3px 0 #9db4d3}
.copx-col.review .ch{box-shadow:inset 0 3px 0 #6d9ad0} .copx-col.estimate .ch{box-shadow:inset 0 3px 0 var(--ax-blue)} .copx-col.exec .ch{box-shadow:inset 0 3px 0 var(--ax-navy)}
.copx-col .ch .t{font-size:13px;font-weight:650}
.copx-col .ch .s{color:var(--ax-muted);opacity:1}
.copx-col .ch .cnt{width:34px;height:34px;right:12px;background:var(--ax-soft);border:1px solid var(--ax-line);color:var(--ax-ink);font-size:15px;font-weight:650;box-shadow:none}
.copx-col .tally{background:transparent;border-bottom:0;padding:9px 14px 0;font-size:11px}
.copx-ph{border-radius:10px;border-color:var(--ax-line)}
.copx-bub{border-width:1.5px;height:27px}
.copx-legend{margin-top:14px;padding-top:12px;border-top:1px solid var(--ax-line2);color:var(--ax-muted)}
.copx-legend .tip{margin-left:auto}
/* tables */
.copx-tbl{border:1px solid var(--ax-line);border-radius:12px}
.copx-tbl th{background:var(--ax-th-bg);color:var(--ax-muted);font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.045em;padding:10px 12px;border-right:0;border-bottom:1px solid var(--ax-line)}
.copx-tbl th.srt:hover,.copx-tbl th.srt.on{background:var(--ax-th-bg);color:var(--ax-blue)}
.copx-tbl tr.flt th{background:var(--ax-card);border-right:0;text-transform:none;letter-spacing:0}
.copx-tbl td{border-bottom-color:var(--ax-line2)}
.copx-tbl tbody tr:last-child td{border-bottom:0}
tr.copx-det td{background:var(--ax-soft)}
.copx-stp{border-radius:10px} .copx-stp h4{background:var(--ax-th-bg)} .copx-stp.cur h4{background:var(--ax-navy)}
.copx-colpick{border-radius:10px}
.copx-dc-card{border-radius:12px;background:var(--ax-card)}
/* tracker view */
.copx-flow-hd{display:flex;gap:10px;align-items:baseline;margin:4px 0 8px;font-size:12.5px} .copx-flow-hd span{color:var(--ax-muted);font-size:11.5px}
.copx-flow{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));border:1px solid var(--ax-line);border-radius:12px;overflow:hidden;background:var(--ax-card)}
@media (max-width:1250px){.copx-flow{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:640px){.copx-flow{grid-template-columns:repeat(2,minmax(0,1fr))}}
.copx-flow .fs{padding:11px 12px 10px;border-right:1px solid var(--ax-line2);border-bottom:1px solid var(--ax-line2);margin:0 -1px -1px 0;display:flex;flex-direction:column;gap:1px;min-width:0}
.copx-flow .k{font-size:10.5px;font-weight:650;color:var(--ax-muted);text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.copx-flow .v{font-size:22px;font-weight:650;letter-spacing:-.02em;line-height:1.25}
.copx-flow .v i{font-style:normal;font-size:11px;font-weight:500;color:var(--ax-muted);margin-left:4px;letter-spacing:0}
.copx-flow .m{font-size:11px;color:var(--ax-muted)}
.copx-flow .lnk{border:0;background:none;padding:0;text-align:left;font:inherit;font-size:11px;font-weight:600;color:var(--ax-link);cursor:pointer}
.copx-flow .lnk:hover{text-decoration:underline}
.copx-flow .fs.none .v{color:var(--ax-neutral)} .copx-flow .fs.over .v{color:var(--ax-red)}
.copx-trk td small{display:block;font-size:10.5px;font-weight:400;color:var(--ax-muted);margin-top:1px}
.copx-trk .mut{color:var(--ax-muted)}
.copx-trk td.w small{white-space:normal;max-width:200px}
.copx-trk .stick{position:sticky;left:0;z-index:1;background:var(--ax-card);box-shadow:1px 0 0 var(--ax-line)}
.copx-trk th.stick{z-index:3;background:var(--ax-th-bg)}
.copx-trk tr.row:hover td.stick{background:var(--ax-acc2)}
.copx-trk .mono{font-family:ui-monospace,Consolas,monospace}
.copx-trk .up{min-width:260px;max-width:360px}
.copx-trk .up .x.keep{-webkit-line-clamp:3;margin-bottom:3px}
.copx-trk .copx-pill{margin-right:0}
.copx-foot{margin:10px 2px 0;font-size:11.5px;color:var(--ax-muted)}
/* ===== 2.9.1 — quieter default view: one-line header, small tiles, helper text moved to hover, a little more colour ===== */
.copx{gap:14px;--ax-tint:color-mix(in srgb,var(--ax-blue) 5%,var(--ax-card));--ax-th-bg:color-mix(in srgb,var(--ax-blue) 6%,var(--ax-card))}
.copx-top{gap:8px 14px}
.copx-top h1{font-size:18px}
.copx-top .acts{margin-left:0;gap:2px}
.copx-fresh{border:0;background:transparent;padding:0;font-size:11.5px;color:var(--ax-muted);cursor:default;gap:6px}
.copx-fresh i{width:7px;height:7px}
.copx-fresh.err{color:var(--ax-red)}
.copx-tabs{margin-left:auto;background:transparent;padding:0;gap:2px;border-radius:0}
.copx-tabs button{padding:5px 10px;font-size:12.5px;border-radius:7px;gap:5px}
.copx-tabs button:hover:not(.on){color:var(--ax-ink);background:var(--ax-line2)}
.copx-tabs button.on{background:var(--ax-blue-soft);color:var(--ax-blue);box-shadow:none}
.copx-tabs button .c,.copx-tabs button.on .c{background:transparent;color:inherit;opacity:.7;padding:0;font-size:11px;line-height:inherit}
.copx-ibtn{justify-content:center;width:30px;height:30px;padding:0;border-color:transparent;background:transparent;color:var(--ax-muted);border-radius:8px}
.copx-ibtn:hover:not(:disabled){background:var(--ax-line2);border-color:transparent;color:var(--ax-ink)}
.copx-card{padding:14px 16px 16px}
.copx-hd{margin-bottom:10px;align-items:center}
.copx-hd h2{font-size:14px}
.copx-hd .n,.copx-frow .n{font-size:11.5px;color:var(--ax-muted)}
.copx-btn.sm{min-height:30px;padding:4px 11px;font-size:12px}
/* tiles: a number and a name — the explanation is the hover text */
.copx-kpis{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.copx-kpi{flex-direction:row;align-items:baseline;gap:6px;border-radius:8px;padding:5px 11px;font-size:12px;line-height:1.35;color:var(--ax-ink2)}
.copx-kpi::before{display:none}
.copx-kpi .n{font-size:14px;font-weight:700;line-height:1.35;letter-spacing:0}
.copx-kpi .l{font-size:12px;font-weight:500}
.copx-kpi:hover:not(:disabled){transform:none;box-shadow:none}
.copx-kpi.r:not(.zero){background:color-mix(in srgb,var(--ax-red) 6%,var(--ax-card));border-color:color-mix(in srgb,var(--ax-red) 28%,var(--ax-line))}
.copx-kpi.a:not(.zero){background:color-mix(in srgb,var(--ax-amber) 7%,var(--ax-card));border-color:color-mix(in srgb,var(--ax-amber) 28%,var(--ax-line))}
.copx-kpi.p:not(.zero){background:color-mix(in srgb,var(--ax-purple) 7%,var(--ax-card));border-color:color-mix(in srgb,var(--ax-purple) 26%,var(--ax-line))}
.copx-kpi.b:not(.zero),.copx-kpi.n:not(.zero){background:color-mix(in srgb,var(--ax-blue) 6%,var(--ax-card));border-color:color-mix(in srgb,var(--ax-blue) 26%,var(--ax-line))}
.copx-kpi.t:not(.zero){background:color-mix(in srgb,var(--ax-teal) 7%,var(--ax-card));border-color:color-mix(in srgb,var(--ax-teal) 28%,var(--ax-line))}
.copx-kpi.g:not(.zero){background:color-mix(in srgb,var(--ax-green) 7%,var(--ax-card));border-color:color-mix(in srgb,var(--ax-green) 28%,var(--ax-line))}
.copx-kpi.zero{color:var(--ax-muted)}
.copx-kpi.on{background:var(--ax-blue-soft);border-color:var(--ax-blue);box-shadow:none}
/* filters: no labels, no search box */
.copx-filters{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin-bottom:12px}
.copx-filters .copx-frow,.copx-frow.trk{gap:8px 10px;align-items:center;margin-bottom:0}
.copx-frow.trk{margin-bottom:12px}
.copx-filters .copx-fbtns,.copx-frow.trk .copx-fbtns{margin-left:0}
.copx-sel{border:1px solid var(--ax-line);border-radius:8px;padding:5px 9px;min-height:30px;background:var(--ax-card);color:var(--ax-ink);font-size:12.5px;max-width:240px}
.copx-sel:focus{outline:2px solid var(--ax-blue-soft);border-color:var(--ax-blue)}
.copx-chk{min-height:30px;font-size:12px}
.copx-filter>summary{color:var(--ax-muted);font-weight:500}
.copx-filter[open]{flex-basis:100%}
.copx-seg button{min-height:30px;padding:4px 11px}
/* board: tinted step headers, slimmer */
.copx-col .ch{min-height:54px;padding:9px 50px 9px 14px;box-shadow:none;border-bottom:1px solid var(--ax-line);background:color-mix(in srgb,var(--ax-blue) 5%,var(--ax-card))}
.copx-col.review .ch{box-shadow:none;background:color-mix(in srgb,var(--ax-blue) 9%,var(--ax-card))}
.copx-col.estimate .ch{box-shadow:none;background:color-mix(in srgb,var(--ax-blue) 13%,var(--ax-card))}
.copx-col.exec .ch{box-shadow:none;background:color-mix(in srgb,var(--ax-teal) 11%,var(--ax-card))}
.copx-col .ch .cnt{width:26px;height:26px;font-size:13px;right:11px;background:var(--ax-card)}
.copx-col{background:var(--ax-card)}
.copx-ph{background:var(--ax-soft)}
.copx-ph .pl{font-size:10px;margin-bottom:6px}
.copx-legend{margin-top:12px;padding-top:10px;gap:14px;font-size:11px}
/* step-time strip */
.copx-flow-hd{display:block;margin:2px 0 6px;font-size:10.5px;font-weight:650;color:var(--ax-muted);text-transform:uppercase;letter-spacing:.05em}
.copx-flow{border-radius:10px;border-top:2px solid transparent;background:linear-gradient(var(--ax-card),var(--ax-card)) padding-box,linear-gradient(90deg,#9db4d3,var(--ax-blue),var(--ax-teal)) border-box}
.copx-flow .fs{padding:8px 11px 7px;gap:0}
.copx-flow .k{font-size:11px;font-weight:600;color:var(--ax-ink2);text-transform:none;letter-spacing:0}
.copx-flow .v{font-size:17px}
.copx-flow .lnk{font-size:10.5px;font-weight:500;color:var(--ax-muted)}
.copx-flow .lnk:hover{color:var(--ax-link)}
/* tables */
.copx-tbl th{padding:8px 12px}
.copx-tbl td{padding:8px 12px}
.copx-trk tr.flt th.stick{z-index:3}
.copx-ibtn.on{background:var(--ax-blue-soft);color:var(--ax-blue)}
.copx-filters .copx-frow{flex:1 1 100%}
/* Day limits: a pop-up card under the gear — switch at the top, one aligned row per step */
.copx-filters{position:relative}
.copx-lim{display:block;position:absolute;right:0;top:calc(100% + 4px);z-index:40;width:min(450px,calc(100vw - 48px));background:var(--ax-card);border:1px solid var(--ax-line);border-radius:14px;
  box-shadow:0 14px 34px rgba(20,30,60,.2);padding:14px 16px 12px;font-size:12.5px}
.copx-lim .lh{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
.copx-lim .lh b{font-size:14px;font-weight:650}
.copx-lim table{width:100%;border-collapse:collapse}
.copx-lim th{font-size:10.5px;font-weight:650;text-transform:uppercase;letter-spacing:.05em;color:var(--ax-muted);text-align:left;padding:0 0 6px}
.copx-lim th.c,.copx-lim td.c{text-align:center;width:86px}
.copx-lim th .d{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
.copx-lim td{padding:5px 0;border-top:1px solid var(--ax-line2)}
.copx-lim input[type=number]{width:62px;margin:0;text-align:center;border:1px solid var(--ax-line);border-radius:8px;padding:4px 6px;background:var(--ax-card);color:var(--ax-ink);font:inherit}
.copx-lim input[type=number]:focus{outline:2px solid var(--ax-blue-soft);border-color:var(--ax-blue)}
.copx-lim.off table{opacity:.45}
.copx-lim .lf{display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:11.5px;color:var(--ax-muted)}
.copx-lim .lnk:disabled{opacity:.4;cursor:default;text-decoration:none}
.copx-sw{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--ax-ink2);cursor:pointer}
.copx-sw input{position:absolute;opacity:0;width:0;height:0}
.copx-sw i{position:relative;flex:none;width:34px;height:20px;border-radius:999px;background:var(--ax-neutral);transition:background .15s}
.copx-sw i::after{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
.copx-sw input:checked+i{background:var(--ax-green)}
.copx-sw input:checked+i::after{transform:translateX(14px)}
.copx-sw input:focus-visible+i{outline:2px solid var(--ax-blue);outline-offset:2px}
/* legend as a hover (opens upward) */
.copx-legendrow{display:flex;justify-content:flex-end;margin-top:6px}
.copx-help.up .pop{top:auto;bottom:100%;width:250px}
.copx-help .pop .copx-legend{display:flex;flex-direction:column;gap:7px;margin:0 0 8px;padding:0;border:0;font-size:12px;color:var(--ax-ink)}
.copx-hd .acts{align-items:center}
.copx-ibtn.go{color:var(--ax-green);margin-left:-8px}
.copx-ibtn.go:hover:not(:disabled){background:var(--ax-green-soft);color:var(--ax-green)}
body.theme-dark .copx-ibtn.go{color:#66bb6a}
/* relief-codes legend (hover / keyboard focus) */
.copx-help{position:relative;display:inline-flex;align-items:center;font-size:11.5px;font-weight:600;color:var(--ax-muted);cursor:help;padding:6px 8px;border-radius:7px;white-space:nowrap}
.copx-help:hover,.copx-help:focus,.copx-help:focus-within{color:var(--ax-ink);background:var(--ax-line2);outline:none}
.copx-help .pop{display:none;position:absolute;right:0;top:100%;z-index:60;width:390px;max-width:calc(100vw - 32px);background:var(--ax-card);color:var(--ax-ink);border:1px solid var(--ax-line);border-radius:12px;
  box-shadow:0 10px 28px rgba(20,30,60,.22);padding:12px 14px;font-weight:400;font-size:12px;line-height:1.5;cursor:default;white-space:normal;text-align:left}
.copx-help:hover .pop,.copx-help:focus .pop,.copx-help:focus-within .pop{display:block}
.copx-help .pop b.t{display:block;font-size:13px;margin-bottom:4px}
.copx-help .pop code{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;background:var(--ax-soft);border:1px solid var(--ax-line2);border-radius:5px;padding:1px 5px}
.copx-help .pop .rcs{display:flex;flex-direction:column;gap:2px;margin:8px 0}
.copx-help .pop .rc{display:grid;grid-template-columns:56px 1fr auto;gap:8px;align-items:baseline;width:100%;text-align:left;border:1px solid transparent;background:transparent;color:var(--ax-ink);
  border-radius:7px;padding:4px 8px;font:inherit;font-size:12px;cursor:pointer}
.copx-help .pop .rc:hover,.copx-help .pop .rc:focus-visible{background:var(--ax-blue-soft);border-color:var(--ax-blue);outline:none}
.copx-help .pop .rc i{font-style:normal;font-size:10.5px;font-weight:600;color:var(--ax-muted);opacity:0}
.copx-help .pop .rc:hover i,.copx-help .pop .rc:focus-visible i,.copx-help .pop .rc.done i{opacity:1}
.copx-help .pop .rc.done{background:var(--ax-green-soft);border-color:var(--ax-green)} .copx-help .pop .rc.done i{color:var(--ax-green)}
.copx-help .pop .ex{display:block;color:var(--ax-muted)}
`;

/* Display groups for a check's stage (active steps + the audit engine's lanes). */
const COP_GROUPS = [
  { id: "general",  label: "Throughout",                        stages: ["general"] },
  { id: "qr",       label: "TTI Quality Review",                stages: ["qr", "draft"] },
  { id: "review",   label: "DTRA Program / Compliance Review",   stages: ["review", "program", "compliance"] },
  { id: "estimate", label: "Estimate",                          stages: ["estimate"] },
  { id: "exec",     label: "Execution",                         stages: ["exec", "ready", "transit"] },
  { id: "closeout", label: "Delivery & close-out",               stages: ["delivered"] },
];

function copStateMeta(state) { return COP_STATES[state] || COP_STATES.na; }

function renderCopWorkspace(container) {
  const built = copBuildAll();
  const root = el(`<div class="copx"><style>${COPX_CSS}</style></div>`);
  container.appendChild(root);

  /* Nothing loaded: blank until a pull from ATLAS has finished (never a saved copy). */
  if (!built) {
    const busy = CopPull.busy;
    const empty = el(busy
      ? `<section class="copx-card copx-wait" role="status" aria-live="polite">
          <div class="copx-spin" aria-hidden="true"></div>
          <h2>Getting the latest from ATLAS…</h2>
          <p class="copx-msg">Nothing is shown until the pull has finished, so what you see here is always current.</p>
        </section>`
      : `<section class="copx-card copx-wait">
          <h2>No shipment data loaded</h2>
          <p class="copx-msg">${CopPull.err ? `Couldn't pull from ATLAS — ${esc(CopPull.err)} ` : ""}${copHubDropOn() ? "Drop the SRF UDQ export in the box above, or pull it from ATLAS." : "Pull the SRF UDQ from ATLAS, or browse for the exported .xlsx."}</p>
          <div class="copx-fbtns" style="justify-content:center"><button class="copx-btn green" id="copFetch" type="button">Pull from ATLAS</button>
            ${copHubDropOn() ? "" : `<button class="copx-btn ghost" id="copBrowse" type="button">Browse for the .xlsx…</button>`}</div>
        </section>`);
    root.appendChild(empty);
    if (!busy) {
      empty.querySelector("#copFetch").addEventListener("click", () => copAutoFetch(true));
      const br = empty.querySelector("#copBrowse");
      if (br) br.addEventListener("click", () => { const fi = document.getElementById("fileInput"); if (fi) fi.click(); });
    }
    return;
  }

  /* ---- who's looking: TTI POC (full picture) or requestor (their requests) ---- */
  const roleBar = el(`<div class="copx-role"><span>View as</span>
    <div class="copx-seg"><button type="button" data-role="tti" class="${CopUi.role !== "requestor" ? "on" : ""}">TTI POC</button>
    <button type="button" data-role="requestor" class="${CopUi.role === "requestor" ? "on" : ""}">Requestor</button></div></div>`);
  roleBar.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    if (CopUi.role === b.dataset.role) return;
    CopUi.role = b.dataset.role; CopUi.focus = ""; CopUi.expanded = new Set(); CopUi.q = ""; copRerender();
  }));
  if (!COP_MOCKUP.requestorView) CopUi.role = "tti";
  if (CopUi.role === "requestor") { root.appendChild(roleBar); copRenderRequestor(root, built); return; }

  if (["active", "tracker", "closed"].indexOf(CopUi.view) === -1) CopUi.view = "active";
  const view = CopUi.view;
  const isActive = view !== "closed";

  /* ---- page header: one quiet line — title, data-freshness dot, the three views, icon actions ---- */
  const vbtn = (v, label, n) => `<button type="button" data-v="${v}" class="${view === v ? "on" : ""}" role="tab" aria-selected="${view === v}">${esc(label)}${n === null ? "" : `<span class="c">${n}</span>`}</button>`;
  const ico = (d, w, sz) => `<svg viewBox="0 0 24 24" width="${sz || 15}" height="${sz || 15}" fill="none" stroke="currentColor" stroke-width="${w || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const top = el(`<header class="copx-top">
    <h1>Shipping Operations</h1>${copFreshChip(built)}
    <button class="copx-ibtn go" id="copRefresh" type="button" title="Refresh — pull the latest from ATLAS" aria-label="Refresh from ATLAS" ${CopPull.busy ? "disabled" : ""}>${ico('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', 3, 17)}</button>
    <div class="copx-tabs" role="tablist" aria-label="Shipment views">
      ${vbtn("active", "In progress", built.active.length)}${vbtn("tracker", "Tracker", null)}${vbtn("closed", "Closed audit", built.closed.length)}
    </div>
    <div class="acts">
      ${copReliefLegend()}
      ${view === "tracker" ? "" : `<button class="copx-ibtn" id="copPrint" type="button" title="Print this view" aria-label="Print">${ico('<path d="M6 9V3h12v6"/><rect x="6" y="14" width="12" height="7" rx="1"/><path d="M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/>')}</button>`}
      <button class="copx-ibtn" id="${view === "tracker" ? "copTrkExport" : "copExport"}" type="button" title="Export to Excel" aria-label="Export to Excel">${ico('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/>')}</button>
    </div>
  </header>`);
  if (COP_MOCKUP.requestorView) top.appendChild(roleBar);
  root.appendChild(top);
  if (view === "tracker") { copRenderTracker(root, built); copWireTop(root); return; }

  const all = isActive ? built.active : built.closed;
  const { base, rows } = copFilterRows(all);

  /* ---- main card: tiles, filters, board ---- */
  const card = el(`<section class="copx-card"></section>`);
  root.appendChild(card);
  if (isActive) card.appendChild(copTodayStrip(base));
  card.appendChild(copFilterPanel(built, all));
  if (isActive) {
    // The board shows exactly what's in the table: the filters above and the
    // table's column filters all drive it (counts and tallies follow).
    card.appendChild(copBoard(rows, rows));
    card.appendChild(el(`<div class="copx-legendrow"><span class="copx-help up" tabindex="0" role="button" aria-label="Legend — what the colours on the board mean">Legend
      <span class="pop" role="tooltip"><span class="copx-legend">
        <span><i></i>On track</span><span><i class="p"></i>Today's update due</span><span><i class="a"></i>Needs attention</span><span><i class="r"></i>Missed / overdue</span>
        <span><em>3</em>updates missing</span><span>${COP_CONSOL_ICON}Consol</span></span>
        <span class="ex">Oldest in its status first · hover a shipment for its latest update · click it for details</span></span></span></div>`));
  }
  /* ---- details table ---- */
  const edit = isActive && copCanEdit();
  const sheet = edit && CopUi.updMode;
  const dc = !isActive && CopUi.docCheck;
  const tnote = sheet ? "Every shipment in view — type an update and Save it, or Save all at the end" : dc ? "Required shipping documents on closed requests, and how many of each were prepared"
    : isActive ? "Click a row for its checklist and daily updates · click a header to sort"
    : "Every closed shipment, checked for metric hits (RFQ, daily updates, shipping documents, carrier/AWB, delivery vs RDD, cost, invoicing) · click a header to sort";
  const tcard = el(`<section class="copx-card">
    <div class="copx-hd"><h2 title="${esc(tnote)}">${sheet ? "Daily status updates" : dc ? "Doc check" : isActive ? "Shipment details" : "Post-shipment audit"}</h2>
      ${rows.length === base.length ? "" : `<span class="n">${rows.length} of ${base.length}</span>`}
      <div class="acts">${!isActive ? `<button class="copx-btn ${dc ? "blue" : "addb"}" id="copDocCheck" type="button" aria-pressed="${!!dc}">${dc ? "Back to audit" : "Doc Check"}</button>` : ""}${sheet || dc ? "" : copColsBtn("copCols", CopUi.colsOpen)}
      ${edit ? `<button class="copx-btn ${sheet ? "blue" : "addb"}" id="copUpdMode" type="button">${sheet ? "Back to shipment details" : "Enter daily updates"}</button>` : ""}</div></div>
  </section>`);
  root.appendChild(tcard);
  if (!sheet && !dc && CopUi.colsOpen) tcard.appendChild(copColumnPicker(isActive));
  tcard.appendChild(sheet ? copUpdatesSheet(rows) : dc ? copDocCheck(base) : copTable(rows, isActive, base));

  copWire(root, built, rows, isActive);
}

/** Where the data on screen came from, and when: a small dot and a word — the
    full story is the hover text. A failed refresh only shows when what's on
    screen is an earlier ATLAS pull (outside ATLAS a pull can't work, and a
    dropped file isn't made stale by it). */
function copFreshChip(built) {
  const n = built ? built.active.length + built.closed.length : 0;
  if (CopPull.busy) return `<span class="copx-fresh busy" title="Pulling the latest from ATLAS…"><i></i>Refreshing…</span>`;
  const fromAtlas = /^ATLAS API/i.test(AppState.fileName || "");
  if (!fromAtlas) return `<span class="copx-fresh file" title="${esc(`From a file · ${AppState.fileName || "UDQ export"} · ${copPlural(n, "request")}`)}"><i></i>From file</span>`;
  const at = CopPull.okAt ? new Date(CopPull.okAt) : null;
  const when = !at ? "ATLAS" : at.toDateString() === new Date().toDateString()
    ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : copClock(CopPull.okAt);
  if (CopPull.err) return `<span class="copx-fresh err" title="${esc(`The last refresh didn't go through — ${CopPull.err} Showing the ATLAS pull from ${at ? copClock(CopPull.okAt) : "earlier"}.`)}"><i></i>${esc(when)} · not refreshed</span>`;
  return `<span class="copx-fresh ok" title="${esc(`Live from ATLAS${at ? ` · pulled ${copClock(CopPull.okAt)}` : ""} · ${copPlural(n, "request")}`)}"><i></i>${esc(when)}</span>`;
}
/** Put text on the clipboard (async API, with the old selection trick as a fallback). */
async function copCopyText(text) {
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (e) { return false; }
}
/** "Choose columns" icon button (Shipment details / Closed audit / Tracker). */
function copColsBtn(id, open, extra) {
  return `<button class="copx-ibtn ${open ? "on" : ""}" id="${id}" type="button" title="Choose which columns show" aria-label="Choose columns" aria-expanded="${!!open}" ${extra || ""}>
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></svg></button>`;
}
/** View switch + Refresh (shared by every view). */
function copWireTop(root) {
  // Relief-codes legend: click a code -> its tag is on the clipboard, ready to paste into ATLAS.
  root.querySelectorAll(".copx-help .rc").forEach((b) => b.addEventListener("click", async () => {
    const ok = await copCopyText(`[RELIEF: ${b.dataset.relief}] `);
    const tag = b.querySelector("i");
    root.querySelectorAll(".copx-help .rc").forEach((x) => { x.classList.remove("done"); x.querySelector("i").textContent = "Copy"; });
    b.classList.toggle("done", ok);
    tag.textContent = ok ? "Copied ✓" : "Couldn't copy";
    setTimeout(() => { b.classList.remove("done"); tag.textContent = "Copy"; }, 2500);
  }));
  root.querySelectorAll(".copx-tabs button").forEach((b) => b.addEventListener("click", () => {
    if (CopUi.view === b.dataset.v) return;
    CopUi.view = b.dataset.v; CopUi.hit = ""; CopUi.quick = ""; CopUi.focus = ""; copRerender();
  }));
  const rf = root.querySelector("#copRefresh");
  if (rf) rf.addEventListener("click", () => copAutoFetch(true));
}

/** Filters: TTI POC (plus Metric hits / needs-attention on the Closed audit). No
    search box — the table's own column filters do that. The gear at the right
    of the row opens the Day limits (time-in-step flags); the old "More"
    dropdown and its RDD filter are gone (2.9.9). */
function copFilterPanel(built, all) {
  const prefs = copGetPrefs();
  // TTI POC choices come from the shipments in this view only.
  const pocs = Array.from(new Set(all.map((r) => r.poc).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  if (CopUi.poc && !pocs.some((p) => copLow(p) === copLow(CopUi.poc))) CopUi.poc = "";
  const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(t)}</option>`;
  const hits = {};
  for (const r of all) for (const c of r.checks) {
    if (c.state !== "fail" && c.state !== "warn" && c.state !== "due") continue;
    const h = hits[c.id] || (hits[c.id] = { label: c.label, n: 0 });
    h.n++;
  }
  const isActive = CopUi.view !== "closed";     // Active: "Needs attention only" covers it
  if (isActive || (CopUi.hit && !hits[CopUi.hit])) CopUi.hit = "";
  const hitOpts = opt("", "All metric hits", !CopUi.hit) + Object.keys(hits).sort((a, b) => hits[b].n - hits[a].n)
    .map((id) => opt(id, `${hits[id].label} (${hits[id].n})`, CopUi.hit === id)).join("");
  const lim = (k, i, word) => `<td class="c"><input type="number" min="1" max="200" data-k="${k}" data-i="${i}" value="${prefs.stuck[k][i]}" ${prefs.stuckOn ? "" : "disabled"}
      aria-label="${esc(COP_STUCK_LABELS[k])} — ${word} after this many business days"></td>`;
  const stuckRows = Object.keys(COP_STUCK_DEFAULTS).map((k) => `<tr><td>${esc(COP_STUCK_LABELS[k])}</td>${lim(k, 0, "amber")}${lim(k, 1, "red")}</tr>`).join("");
  CopUi.rddDays = 0;                     // the RDD filter is gone (2.9.9) — make sure none is left switched on
  return el(`<div class="copx-filters">
    <div class="copx-frow">
      <select id="copPoc" class="copx-sel" aria-label="TTI POC">${opt("", "All TTI POCs", !CopUi.poc)}${pocs.map((p) => opt(p, p, copLow(p) === copLow(CopUi.poc))).join("")}</select>
      ${isActive ? "" : `<select id="copHit" class="copx-sel" aria-label="Metric hits">${hitOpts}</select>
      <label class="copx-chk"><input type="checkbox" id="copRisk" ${CopUi.atRisk ? "checked" : ""}> Needs attention only</label>`}
      <button class="copx-btn ghost sm" id="copReset" type="button">Reset</button>
      <span class="copx-msg" id="copMsg">${esc(CopUi.msg)}</span>
      ${isActive ? `<button class="copx-ibtn ${CopUi.settingsOpen ? "on" : ""}" id="copLimits" type="button" style="margin-left:auto" aria-expanded="${!!CopUi.settingsOpen}"
        title="Day limits — flag shipments that sit too long in a step${prefs.stuckOn ? " (on)" : " (off)"}" aria-label="Day limits settings">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button>` : ""}
    </div>
    ${isActive && CopUi.settingsOpen ? `<div class="copx-limits copx-lim ${prefs.stuckOn ? "" : "off"}" role="dialog" aria-label="Day limits">
      <div class="lh"><b title="Flags a shipment that sits in one step longer than these limits. Off by default — only the RFQ timeline is flagged.">Day limits</b>
        <label class="copx-sw"><input type="checkbox" id="copStuckOn" ${prefs.stuckOn ? "checked" : ""}><i></i><span>${prefs.stuckOn ? "On" : "Off"}</span></label></div>
      <table><thead><tr><th>Step</th><th class="c"><span class="d" style="background:var(--ax-amber)"></span>Amber</th><th class="c"><span class="d" style="background:var(--ax-red)"></span>Red</th></tr></thead>
        <tbody>${stuckRows}</tbody></table>
      <div class="lf"><span>Business days in the step</span><button class="lnk" id="copStuckReset" type="button" ${prefs.stuckOn ? "" : "disabled"}>Reset</button></div>
    </div>` : ""}
  </div>`);
}

/* =========================================================================
   TRACKER VIEW (2.9.0) — the Ops Tracker, straight from ATLAS. One row per
   shipment that's in progress or was delivered on / after COP_FIELDS_FROM_ISO,
   with the tracker's columns: every milestone date start to finish (and the
   business days each step took), Original vs current RDD, RFQ sent within one
   business day, EEI filed before departure (ITN / NOEEI), MARAD, invoices
   received, team notes and the latest daily update. The tiles on top are the
   metrics the tracker was kept for; the strip under them is how long each
   step takes on average and which shipment took longest.
   ========================================================================= */
const COP_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COP_TL_STEPS = [
  { id: "qr",   label: "TTI Quality Review",   from: "submitted",  to: "toDtra",     hint: "Submitted → sent to DTRA" },
  { id: "dtra", label: "DTRA review",          from: "toDtra",     to: "compliance", hint: "With DTRA → Compliance approved" },
  { id: "pack", label: "Packing",              from: "compliance", to: "packed",     hint: "Compliance approved → Date Packed" },
  { id: "rfq",  label: "RFQ",                  from: "rfqStart",   to: "rfq",        hint: "Later of Compliance approval and Date Packed → RFQ Sent Date", goal: 1 },
  { id: "est",  label: "Estimate prep",        from: "rfq",        to: "quoteSub",   hint: "RFQ sent → estimate submitted to DTRA" },
  { id: "appr", label: "DTRA estimate review", from: "quoteSub",   to: "quoteAppr",  hint: "Estimate submitted → approved" },
  { id: "book", label: "Booking & pickup",     from: "quoteAppr",  to: "departed",   hint: "Estimate approved → departed origin" },
  { id: "move", label: "Transit",              from: "departed",   to: "delivered",  hint: "Departed origin → delivered" },
];
const COP_NA_RE = /^(|n[\/_ ]?a|none|no|non[- ]?haz(ardous|mat)?|not applicable|not required|tbd|false|ambient|room temp(erature)?|see the inventory list)$/i;

/** One tracker row per shipment in progress or delivered since 1 Oct 2026. */
function copTrackerRows(built) {
  const today = built.ctx.today;
  const mk = (r, active) => {
    const rec = r.rec, tl = copTimeline(rec), sc = copShipClass(rec), m = copMilestones(rec);
    tl.rfqStart = tl.compliance && tl.packed && tl.packed.getTime() > tl.compliance.getTime() ? tl.packed : tl.compliance;
    // Past TTI Estimate Preparation (or delivered): Date Packed and RFQ Sent Date belong on the record by now.
    const pastPrep = !active || r.stepIdx > COP_STEP_IDX.estimate || (r.stepIdx === COP_STEP_IDX.estimate && copLow(r.status) !== "tti estimate preparation");
    const noQuote = sc.handCarry;                    // hand carry only — courier shipments DO need a pack date and RFQ date (user, 2026-11-22)
    // RFQ: due one business day after the later of Compliance approval and Date Packed.
    let rfq = { st: "none", due: null };
    if (!tl.rfq && m.rfq) rfq = { st: "na", due: null };                    // text, not a date: no RFQ needed
    else if (tl.rfqStart) {
      const due = xtWorkday(tl.rfqStart, 1, true);
      if (tl.rfq) rfq = { st: tl.rfq.getTime() <= due.getTime() ? "ontime" : "late", due };
      else if (pastPrep) rfq = { st: "missing", due };   // past Estimate Preparation: it went out, the date just isn't in ATLAS -> a record to fix
      else if (!tl.packed) rfq = { st: "wait", due: null };
      else rfq = { st: today.getTime() > due.getTime() ? "overdue" : "due", due };
    } else if (tl.rfq) rfq = { st: "sent", due: null };
    if (!tl.rfq && noQuote && rfq.st !== "na") rfq = { st: "na", due: null };
    else if (rfq.st === "none" && pastPrep) rfq = { st: "missing", due: null };
    let packMissing = !tl.packed && pastPrep && !noQuote;
    // EEI: every US export except hand carry needs an ITN / NOEEI citation before it leaves.
    let eei = "na";
    if (sc.category === "EXPORT" && !sc.handCarry) {
      const left = !!tl.departed || !active || (r.step === "exec" && COP_PHASE_IDX[r.phase] >= COP_PHASE_IDX.transit);
      eei = m.itn ? "filed" : left ? "missed" : r.step === "exec" ? "hold" : "later";   // "later": not in Execution yet
    }
    // MARAD (sealift): due N working days after departure from origin.
    let marad = { st: "na", due: null, sub: null };
    if (sc.ocean) {
      const due = tl.departed ? xtWorkday(tl.departed, sc.originUs ? COP_MARAD_WORKDAYS_US : COP_MARAD_WORKDAYS_FOREIGN, true) : null;
      const sub = xtParseDate(m.maradSub);
      marad = { due, sub, st: sub ? "done" : /^n\/?a$/i.test(m.maradSub) ? "na" : !due ? "later" : today.getTime() > due.getTime() ? "overdue" : "due" };
    }
    // Relief codes: an open / late / missing item shows "Relieved" instead.
    const rel = copReliefFor(rec), rh = (k) => copReliefHit(rel, [k]);
    if (rh("cop.rfq") && /late|overdue|due|wait|missing/.test(rfq.st)) rfq = { st: "relief", due: null, why: rh("cop.rfq").reason };
    let eeiWhy = "";
    if (rh("cop.itn") && (eei === "hold" || eei === "missed" || eei === "later")) { eeiWhy = rh("cop.itn").reason; eei = "relief"; }
    if (rh("cop.packed")) packMissing = false;
    if (rh("cop.marad") && /overdue|due|later/.test(marad.st)) marad = { st: "relief", due: null, sub: null, why: rh("cop.marad").reason };
    const changed = !!(tl.origRdd && tl.rdd && xtIso(tl.origRdd) !== xtIso(tl.rdd));
    const { items } = copInvLines(rec);
    // DG: a real UN number, or a hazard class with a digit in it ("9", "Class 2.1").
    const haz = items.some((x) => /(^|\b)(un\s*)?\d{4}\b/i.test(norm(copInv(x, /^un code/)))
      || (/\d/.test(norm(copInv(x, /^hazmat/))) && !COP_NA_RE.test(norm(copInv(x, /^hazmat/)))));
    const temp = !COP_NA_RE.test(norm(rec.f["temperature-control requirements"] || ""));
    const note = rec.daily.length ? rec.daily.slice().sort((a, b) => b.date - a.date)[0] : null;
    return { r, active, tl, sc, m, rfq, eei, eeiWhy, marad, packMissing, changed, slip: changed ? copCalDays(tl.origRdd, tl.rdd) : 0, haz, temp, note,
      whInv: xtParseDate(m.whInv), shipInv: xtParseDate(m.shipInv) };
  };
  // Furthest along first (like the details table), then the delivered ones, newest first.
  const act = built.active.map((r) => mk(r, true)).sort((a, b) => (b.r.stepIdx - a.r.stepIdx)
    || ((COP_PHASE_IDX[b.r.phase] || 0) - (COP_PHASE_IDX[a.r.phase] || 0)) || a.r.num - b.r.num);
  const del = built.closed.filter((r) => !copPreFields(r.rec) && !/^(cancel|shipment cancel)/.test(copLow(r.status)))
    .map((r) => mk(r, false)).sort((a, b) => copCmp(b.tl.delivered ? b.tl.delivered.getTime() : null, a.tl.delivered ? a.tl.delivered.getTime() : null) || b.r.num - a.r.num);
  return act.concat(del);
}
/* Tracker tiles double as filters. */
const COP_TRK_PICK = {
  rfq: (x) => x.rfq.st === "late" || x.rfq.st === "overdue",
  fix: (x) => x.rfq.st === "missing" || x.packMissing,          // blank Date Packed / RFQ Sent Date that should be filled
  eei: (x) => x.eei === "hold" || x.eei === "missed",
  rdd: (x) => x.changed,
  inv: (x) => !x.active && !x.shipInv,
  marad: (x) => x.marad.st === "overdue" || x.marad.st === "due",
};
/** Average business days per step, and the shipment that took longest. */
function copStepTimes(xs) {
  return COP_TL_STEPS.map((s) => {
    const ds = [];
    for (const x of xs) {
      const a = x.tl[s.from], b = x.tl[s.to];
      if (!a || !b || b.getTime() < a.getTime()) continue;
      ds.push({ n: copBizDaysBetween(a, b), x });
    }
    ds.sort((p, q) => q.n - p.n);
    return { s, n: ds.length, avg: ds.length ? ds.reduce((t, d) => t + d.n, 0) / ds.length : null, max: ds[0] || null };
  });
}
function copTrkCols(today) {
  const yr = today.getFullYear();
  const sd = (d) => d ? `${d.getDate()} ${COP_MON[d.getMonth()]}${d.getFullYear() !== yr ? " ’" + String(d.getFullYear()).slice(2) : ""}` : "";
  const dash = `<span class="mut">—</span>`;
  const gap = (a, b) => (a && b && b.getTime() >= a.getTime()) ? `<small title="Business days since the step before">+${copBizDaysBetween(a, b)}d</small>` : "";
  const dcol = (id, label, key, prev, title) => ({ id, label, title,
    sort: (x) => x.tl[key] ? x.tl[key].getTime() : null, ex: (x) => copFmt(x.tl[key]),
    td: (x) => `<td class="nw">${x.tl[key] ? esc(sd(x.tl[key])) + gap(prev && x.tl[prev], x.tl[key]) : dash}</td>` });
  const RFQ = { ontime: ["g", "On time"], late: ["r", "Late"], overdue: ["r", "Overdue"], due: ["b", "Due"], wait: ["", "Waiting on pack date"], missing: ["a", "Missing"], na: ["", "No RFQ needed"], relief: ["t", "Relieved"], sent: ["", ""], none: ["", ""] };
  const rfqWord = (x) => { const w = RFQ[x.rfq.st][1]; return w + (x.rfq.due && /late|overdue|due/.test(x.rfq.st) ? ` · due ${sd(x.rfq.due)}` : ""); };
  const EEI = { filed: ["g", "Released"], hold: ["a", "Hold · ITN needed"], missed: ["r", "Departed without ITN"], later: ["", "Needed before departure"], relief: ["t", "Relieved"], na: ["", "Not a US export"] };
  const MAR = { done: ["g", "Submitted"], overdue: ["r", "Overdue"], due: ["b", "Due"], later: ["", "After departure"], relief: ["t", "Relieved"], na: ["", ""] };
  const pill = (cls, text) => !text ? "" : cls ? `<span class="copx-pill ${cls}">${esc(text)}</span>` : `<span class="mut">${esc(text)}</span>`;
  return [
    { id: "wmtr", label: "WMTR", sort: (x) => x.r.num, ex: (x) => x.r.wmtr, ft: "text", fv: (x) => `${x.r.wmtr} ${x.r.status}`,
      td: (x) => `<td class="w stick">${copWmtrLink(x.r, x.r.last5)}${x.haz ? ` <span class="copx-pill a" title="HAZMAT / dangerous goods on the inventory">DG</span>` : ""}${x.temp ? ` <span class="copx-pill b" title="Temperature control: ${esc(x.r.rec.f["temperature-control requirements"] || "")}">Temp</span>` : ""}
        <small>${x.active ? esc(x.r.status) : `<span class="copx-pill g">Delivered</span> ${esc(x.r.status)}`}</small></td>` },
    { id: "route", label: "Route · Program", sort: (x) => copLow(x.r.dest) || null, ex: (x) => `${x.r.origin} → ${x.r.dest}`,
      ft: "text", fv: (x) => `${x.r.origin} → ${x.r.dest} ${x.r.program} ${x.r.mode}`,
      td: (x) => `<td class="nw">${esc(x.r.origin || "?")} → ${esc(x.r.dest || "?")}<small>${esc([x.r.program, x.r.mode].filter(Boolean).join(" · "))}</small></td>` },
    { id: "poc", label: "TTI POC", sort: (x) => copLow(x.r.poc) || null, ex: (x) => x.r.poc, td: (x) => `<td class="nw">${esc(x.r.poc || "—")}</td>` },
    dcol("submitted", "Submitted", "submitted", null, "First Workflow Logs stamp after Draft"),
    dcol("toDtra", "To DTRA", "toDtra", "submitted", "First DTRA Program Review stamp"),
    dcol("compliance", "Compliance", "compliance", "toDtra", "DTRA Compliance Review approved"),
    { id: "packed", label: "Packed", title: "ATLAS field: Date Packed — needed once the request is past Estimate Preparation",
      sort: (x) => x.tl.packed ? x.tl.packed.getTime() : null, ex: (x) => copFmt(x.tl.packed), fv: (x) => x.tl.packed ? "Entered" : x.packMissing ? "Missing" : "",
      td: (x) => `<td class="nw">${x.tl.packed ? esc(sd(x.tl.packed)) + gap(x.tl.compliance, x.tl.packed) : x.packMissing ? `<span class="copx-pill a" title="Date Packed is blank in ATLAS">Missing</span>` : dash}</td>` },
    { id: "rfq", label: "RFQ sent", title: "ATLAS field: RFQ Sent Date — due 1 business day after the later of Compliance approval and Date Packed",
      sort: (x) => x.tl.rfq ? x.tl.rfq.getTime() : null, ex: (x) => copFmt(x.tl.rfq), exx: rfqWord, fv: (x) => RFQ[x.rfq.st][1],
      td: (x) => `<td class="nw"${x.rfq.st === "relief" ? ` title="${esc("Relieved — " + (x.rfq.why || "no reason given"))}"` : ""}>${x.tl.rfq ? esc(sd(x.tl.rfq)) : ""} ${pill(RFQ[x.rfq.st][0], rfqWord(x)) || (x.tl.rfq ? "" : dash)}</td>` },
    dcol("quoteSub", "Quote sub.", "quoteSub", "rfq", "Estimate submitted to DTRA (first DTRA Estimate Review stamp)"),
    dcol("quoteAppr", "Quote appr.", "quoteAppr", "quoteSub", "DTRA Estimate Review approved"),
    { id: "origRdd", label: "Original RDD", title: "ATLAS field: Original RDD", sort: (x) => x.tl.origRdd ? x.tl.origRdd.getTime() : null, ex: (x) => copFmt(x.tl.origRdd),
      td: (x) => `<td class="nw">${x.tl.origRdd ? esc(sd(x.tl.origRdd)) : dash}</td>` },
    { id: "rdd", label: "Current RDD", title: "ATLAS field: NLT Completion Date", sort: (x) => x.tl.rdd ? x.tl.rdd.getTime() : null, ex: (x) => copFmt(x.tl.rdd),
      exx: (x) => x.changed ? `${x.slip > 0 ? "+" : ""}${x.slip} days` : "",
      td: (x) => `<td class="nw">${x.tl.rdd ? esc(sd(x.tl.rdd)) : dash}${x.changed ? ` <span class="copx-pill ${x.slip > 0 ? "a" : "b"}" title="Changed from ${esc(copFmt(x.tl.origRdd))}">${x.slip > 0 ? "+" : "−"}${Math.abs(x.slip)}d</span>` : ""}</td>` },
    { id: "dep", label: "Departure", title: "Departure from Origin — actual date, or the estimate until it leaves",
      sort: (x) => (x.tl.departed || x.tl.etd) ? (x.tl.departed || x.tl.etd).getTime() : null, ex: (x) => copFmt(x.tl.departed || x.tl.etd), exx: (x) => x.tl.departed ? "Actual" : x.tl.etd ? "Estimate" : "",
      td: (x) => `<td class="nw">${x.tl.departed ? esc(sd(x.tl.departed)) + gap(x.tl.quoteAppr, x.tl.departed) : x.tl.etd ? `${esc(sd(x.tl.etd))}<small>estimate</small>` : dash}</td>` },
    { id: "eei", label: "EEI · ITN / NOEEI", title: "ATLAS field: ITN / NOEEI Citation — must be in before a US export departs",
      sort: (x) => ({ missed: 0, hold: 1, later: 2, filed: 3, relief: 4, na: 5 })[x.eei], ex: (x) => x.m.itn, exx: (x) => EEI[x.eei][1], fv: (x) => EEI[x.eei][1],
      td: (x) => `<td class="nw"${x.eei === "relief" ? ` title="${esc("Relieved — " + (x.eeiWhy || "no reason given"))}"` : ""}>${pill(EEI[x.eei][0], EEI[x.eei][1])}${x.m.itn ? `<small class="mono">${esc(x.m.itn)}</small>` : ""}</td>` },
    { id: "marad", label: "MARAD", fv: (x) => MAR[x.marad.st][1], title: "Sealift only — due 20 working days after departure (30 from abroad); ATLAS field: MARAD Submitted Date",
      sort: (x) => ({ overdue: 0, due: 1, later: 2, done: 3, relief: 4, na: 5 })[x.marad.st], ex: (x) => copFmt(x.marad.sub), exx: (x) => MAR[x.marad.st][1] + (x.marad.due && !x.marad.sub ? ` · due ${copFmt(x.marad.due)}` : ""),
      td: (x) => `<td class="nw"${x.marad.st === "relief" ? ` title="${esc("Relieved — " + (x.marad.why || "no reason given"))}"` : ""}>${x.marad.st === "na" ? dash : pill(MAR[x.marad.st][0], MAR[x.marad.st][1] + (x.marad.sub ? ` ${sd(x.marad.sub)}` : x.marad.due ? ` ${sd(x.marad.due)}` : ""))}</td>` },
    dcol("delivered", "Delivered", "delivered", "departed", "ATLAS field: Delivery Date"),
    { id: "inv", label: "Invoices rec’d", xl: "Warehouse invoice rec'd", xl2: "Final shipping invoice rec'd", title: "ATLAS fields: Warehouse Invoice Received · Final Shipping Invoice Received",
      sort: (x) => (x.whInv ? 1 : 0) + (x.shipInv ? 2 : 0), ex: (x) => copFmt(x.whInv), exx: (x) => copFmt(x.shipInv),
      td: (x) => `<td class="nw">${x.whInv || x.shipInv ? `${x.whInv ? `Warehouse ${esc(sd(x.whInv))}` : `<span class="mut">Warehouse —</span>`}<small>${x.shipInv ? `Final shipping ${esc(sd(x.shipInv))}` : "Final shipping —"}</small>` : dash}</td>` },
    // The Ops Tracker's "Status Notes" column = the latest daily status update.
    { id: "update", label: "Latest update", xl: "Latest update — date", xl2: "Latest update", title: "The newest daily status update",
      ft: "text", fv: (x) => x.note ? x.note.note : "",
      sort: (x) => x.note ? x.note.date.getTime() : null, ex: (x) => x.note ? copFmt(x.note.date) : "", exx: (x) => x.note ? x.note.note : "",
      td: (x) => `<td class="up">${x.note ? `<span class="d">${esc(sd(x.note.date))}</span><span class="x">${esc(x.note.note)}</span>` : dash}</td>` },
    // Shipping Team Notes is its own ATLAS field (team notes; later, the relief codes).
    { id: "team", label: "Team notes", title: COP_RELIEF_TITLE, ft: "text", fv: (x) => x.m.notes,
      sort: (x) => copLow(x.m.notes) || null, ex: (x) => x.m.notes,
      td: (x) => `<td class="up">${x.m.notes ? `<span class="x keep">${copNotesHtml(x.m.notes)}</span>` : dash}</td>` },
  ];
}

/* Tracker view settings, kept in this browser: columns switched off and whether
   the step-time strip shows. Only what's OFF is stored, so a new column
   starts out visible. */
/* Columns that start switched off (less in the default view; Columns brings them back). Delivered and
   Invoices rec'd still show by themselves on the Delivered / All lists until the user makes their own pick. */
const COP_TRK_OFF_DEFAULT = ["poc", "toDtra", "quoteSub", "origRdd", "marad", "delivered", "inv"];
function copTrkPrefs() {
  const t = copGetPrefs().trk;
  const o = (t && typeof t === "object") ? t : {};
  const custom = o.v === 2 && Array.isArray(o.off);        // saved by this version's picker
  return { off: custom ? o.off : COP_TRK_OFF_DEFAULT.slice(), flow: o.flow !== false, custom };
}
function copSetTrkPrefs(t) { const p = copGetPrefs(); if (t) p.trk = { off: t.off, flow: t.flow, v: 2 }; else delete p.trk; copSetPrefs(p); }
function copRenderTracker(root, built) {
  const today = built.ctx.today;
  const tp = copTrkPrefs();
  let xs = copTrackerRows(built);
  const pocs = Array.from(new Set(xs.map((x) => x.r.poc).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  if (CopUi.poc && !pocs.some((p) => copLow(p) === copLow(CopUi.poc))) CopUi.poc = "";
  if (CopUi.poc) xs = xs.filter((x) => copLow(x.r.poc) === copLow(CopUi.poc));
  const nAct = xs.filter((x) => x.active).length, nDel = xs.length - nAct;
  const scope = ["all", "active", "delivered"].indexOf(CopUi.trkScope) !== -1 ? CopUi.trkScope : "active";
  const inScope = xs.filter((x) => scope === "all" || (scope === "active") === x.active);
  const allCols = copTrkCols(today);
  if (!tp.custom && scope !== "active") tp.off = tp.off.filter((id) => id !== "delivered" && id !== "inv");
  const cols = allCols.filter((c) => c.id === "wmtr" || tp.off.indexOf(c.id) === -1);
  const F = CopUi.trkF || (CopUi.trkF = {});
  let rows = inScope;
  if (CopUi.trkPick && !COP_TRK_PICK[CopUi.trkPick]) CopUi.trkPick = "";
  if (CopUi.trkPick) rows = rows.filter(COP_TRK_PICK[CopUi.trkPick]);
  for (const c of cols) {
    const v = F[c.id];
    if (!v || !c.fv) continue;
    rows = c.ft === "text" ? rows.filter((x) => copLow(c.fv(x)).includes(copLow(v))) : rows.filter((x) => c.fv(x) === v);
  }

  /* ---- the metrics the tracker was kept for (small tiles; the hover text explains each) ---- */
  const cnt = (f) => inScope.filter(f).length;
  const rfqOn = cnt((x) => x.rfq.st === "ontime"), rfqLate = cnt((x) => x.rfq.st === "late"), rfqOver = cnt((x) => x.rfq.st === "overdue");
  const rfqTot = rfqOn + rfqLate + rfqOver;
  const eeiOk = cnt((x) => x.eei === "filed"), eeiMiss = cnt((x) => x.eei === "missed"), eeiHold = cnt((x) => x.eei === "hold");
  const withOrig = inScope.filter((x) => x.tl.origRdd && x.tl.rdd), chg = withOrig.filter((x) => x.changed);
  const avgSlip = chg.length ? Math.round(chg.reduce((t, x) => t + x.slip, 0) / chg.length) : 0;
  const done = inScope.filter((x) => !x.active && x.tl.submitted && x.tl.delivered);
  const avgDays = done.length ? Math.round(done.reduce((t, x) => t + copCalDays(x.tl.submitted, x.tl.delivered), 0) / done.length) : null;
  const invOut = cnt(COP_TRK_PICK.inv), mar = cnt(COP_TRK_PICK.marad), hasOcean = inScope.some((x) => x.marad.st !== "na");
  const fixN = cnt(COP_TRK_PICK.fix), rfqBlank = cnt((x) => x.rfq.st === "missing"), packBlank = cnt((x) => x.packMissing);
  const pct = (a, b) => b ? Math.round((a / b) * 100) + "%" : "—";
  const tile = (key, tone, big, label, hint) => `<button type="button" class="copx-kpi ${tone} ${CopUi.trkPick === key && key ? "on" : ""} ${big === 0 || big === "—" ? "zero" : ""}" ${key ? `data-pick="${key}"` : "disabled"} aria-pressed="${CopUi.trkPick === key && !!key}" title="${esc(hint)}">
      <span class="n">${esc(String(big))}</span><span class="l">${esc(label)}</span></button>`;
  const tiles = el(`<div class="copx-kpis" role="group" aria-label="Tracker metrics — click a tile to filter">
    ${tile("fix", fixN ? "a" : "", fixN, fixN === 1 ? "record to fix" : "records to fix",
      `Past Estimate Preparation with a blank field in ATLAS — Date Packed: ${packBlank} · RFQ Sent Date: ${rfqBlank}`)}
    ${tile("rfq", !rfqTot ? "" : rfqLate + rfqOver ? "r" : "g", pct(rfqOn, rfqTot), "RFQs on time",
      rfqTot ? `RFQ sent within 1 business day: ${rfqOn} of ${rfqTot}${rfqOver ? ` · ${rfqOver} overdue now` : ""}${rfqLate ? ` · ${rfqLate} sent late` : ""}${rfqBlank ? ` · ${rfqBlank} more have no RFQ date` : ""}` : "RFQ sent within 1 business day — no RFQ dates entered yet")}
    ${tile("eei", eeiMiss ? "r" : eeiHold ? "a" : eeiOk ? "g" : "", eeiOk + eeiMiss ? `${eeiOk}/${eeiOk + eeiMiss}` : "—", "EEI filed before departure",
      `US exports that left with an ITN / NOEEI citation${eeiHold ? ` · ${eeiHold} in Execution still to file` : ""}`)}
    ${tile("rdd", chg.length ? "a" : "", chg.length, "RDD changed", withOrig.length ? `Of ${withOrig.length} with an Original RDD${chg.length ? ` · average ${avgSlip > 0 ? "+" : ""}${avgSlip} days` : ""}` : "No Original RDD entered yet")}
    ${done.length ? tile("", "", avgDays, "days to deliver", `Average calendar days from submitted to delivered, over ${copPlural(done.length, "shipment")} delivered since 1 Oct`) : ""}
    ${nDel && scope !== "active" ? tile("inv", invOut ? "a" : "", invOut, "invoices outstanding", "Delivered since 1 Oct with no Final Shipping Invoice Received date") : ""}
    ${hasOcean ? tile("marad", mar ? "b" : "", mar, "MARAD open", "Sealift shipments with a MARAD report due or overdue") : ""}
  </div>`);

  const card = el(`<section class="copx-card">
    ${built.ds.hasMilestones ? "" : `<div class="copx-banner">${esc(COP_NO_FIELDS_TEXT)}</div>`}
  </section>`);
  card.appendChild(tiles);
  if (tp.flow) {
    /* ---- how long each step takes ---- */
    const st = copStepTimes(inScope);
    card.appendChild(el(`<div class="copx-flow-hd">Average business days in each step</div>`));
    card.appendChild(el(`<div class="copx-flow" role="list">${st.map((t) => {
      const over = t.s.goal && t.avg !== null && t.avg > t.s.goal;
      return `<div class="fs ${t.n ? "" : "none"} ${over ? "over" : ""}" role="listitem" title="${esc(`${t.s.hint} · ${t.n ? copPlural(t.n, "shipment") : "no dates yet"}${t.s.goal ? ` · goal ${t.s.goal}` : ""}`)}">
        <span class="k">${esc(t.s.label)}</span>
        <span class="v">${t.avg === null ? "—" : (Math.round(t.avg * 10) / 10)}</span>
        ${t.max && t.max.n > 0 ? `<button type="button" class="lnk" data-find="${esc(t.max.x.r.last5)}" title="Longest in this step — show this shipment">${esc(t.max.x.r.last5)} · ${t.max.n}d</button>` : ""}
      </div>`; }).join("")}</div>`));
  }
  root.appendChild(card);

  /* ---- the table ---- */
  const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(t)}</option>`;
  const seg = (v, t, n) => `<button type="button" data-scope="${v}" class="${scope === v ? "on" : ""}">${esc(t)} <span class="c">${n}</span></button>`;
  const sort = CopUi.trkSort || { id: "", dir: 1 };
  const sc = sort.id && cols.find((c) => c.id === sort.id);
  const shown = !sc ? rows : rows.slice().sort((a, b) => {
    const va = sc.sort(a), vb = sc.sort(b), blank = (v) => v === null || v === undefined || v === "";
    if (blank(va) || blank(vb)) return copCmp(va, vb) || a.r.num - b.r.num;
    return sort.dir * copCmp(va, vb) || a.r.num - b.r.num;
  });
  const head = cols.map((c) => {
    const on = sort.id === c.id;
    return `<th class="srt${on ? " on" : ""}${c.id === "wmtr" ? " stick" : ""}" data-sort="${c.id}" tabindex="0" title="${esc(c.title || "Click to sort")}" aria-sort="${on ? (sort.dir > 0 ? "ascending" : "descending") : "none"}">${esc(c.label)}${on ? ` <span class="ar">${sort.dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`;
  }).join("");
  const fil = cols.map((c) => {
    const stick = c.id === "wmtr" ? ' class="stick"' : "";
    if (!c.fv) return `<th${stick}></th>`;
    const v = F[c.id] || "";
    if (c.ft === "text") return `<th${stick}><input type="search" class="copx-cf" data-cf="${esc(c.id)}" value="${esc(v)}" placeholder="Filter" aria-label="Filter ${esc(c.label)}"></th>`;
    const vals = Array.from(new Set(inScope.map((x) => c.fv(x)).filter(Boolean)));
    if (v && vals.indexOf(v) === -1) vals.push(v);
    vals.sort((a, b) => copCmp(a, b));
    return `<th${stick}><select class="copx-cf" data-cf="${esc(c.id)}" aria-label="Filter ${esc(c.label)}">${opt("", "All", !v)}${vals.map((x) => opt(x, x, x === v)).join("")}</select></th>`;
  }).join("");
  const box = (id, label, on, locked) => `<label class="copx-chk"><input type="checkbox" data-tcol="${esc(id)}" ${on ? "checked" : ""} ${locked ? "disabled" : ""}> ${esc(label)}</label>`;
  const tcard = el(`<section class="copx-card">
    <div class="copx-frow trk">
      <select id="copPoc" class="copx-sel" aria-label="TTI POC">${opt("", "All TTI POCs", !CopUi.poc)}${pocs.map((p) => opt(p, p, copLow(p) === copLow(CopUi.poc))).join("")}</select>
      <div class="copx-seg">${seg("active", "In progress", nAct)}${seg("delivered", "Delivered", nDel)}${seg("all", "All", xs.length)}</div>
      ${rows.length === inScope.length ? "" : `<span class="n">${rows.length} of ${inScope.length}</span>`}
      ${copColsBtn("copTrkView", CopUi.trkViewOpen, 'style="margin-left:auto"')}
      <button class="copx-btn ghost sm" id="copReset" type="button">Reset</button>
    </div>
    ${CopUi.trkViewOpen ? `<div class="copx-colpick">
      <div><div class="k">Columns</div>${allCols.map((c) => box(c.id, c.label.replace("’", "'"), c.id === "wmtr" || tp.off.indexOf(c.id) === -1, c.id === "wmtr")).join("")}</div>
      <div><div class="k">Above the table</div>${box("@flow", "Average business days in each step", tp.flow)}</div>
      <div class="ft"><button class="lnk" type="button" id="copTrkViewRec">Recommended</button> &nbsp;·&nbsp; <button class="lnk" type="button" id="copTrkViewReset">Show everything</button></div>
    </div>` : ""}
    <div class="copx-tbl copx-trk"><table><thead><tr class="hd">${head}</tr><tr class="flt">${fil}</tr></thead>
      <tbody>${shown.map((x) => `<tr class="row" data-w="${esc(x.r.wmtr)}" data-act="${x.active ? 1 : 0}">${cols.map((c) => c.td(x)).join("")}</tr>`).join("")
        || `<tr><td colspan="${cols.length}" class="copx-msg">No shipments match.</td></tr>`}</tbody></table></div>
  </section>`);
  root.appendChild(tcard);

  /* ---- wiring ---- */
  const $ = (s) => root.querySelector(s);
  root.querySelectorAll("button[data-pick]").forEach((b) => b.addEventListener("click", () => { CopUi.trkPick = CopUi.trkPick === b.dataset.pick ? "" : b.dataset.pick; copRerender(); }));
  root.querySelectorAll("button[data-scope]").forEach((b) => b.addEventListener("click", () => { CopUi.trkScope = b.dataset.scope; copRerender(); }));
  root.querySelectorAll("button[data-find]").forEach((b) => b.addEventListener("click", () => { F.wmtr = b.dataset.find; CopUi.trkPick = ""; copRerender(); }));
  $("#copPoc").addEventListener("change", (e) => { CopUi.poc = e.target.value; copRerender(); });
  $("#copReset").addEventListener("click", () => { Object.assign(CopUi, { poc: "", q: "", trkPick: "", trkScope: "active", trkSort: null, trkF: {} }); copRerender(); });
  $("#copTrkView").addEventListener("click", () => { CopUi.trkViewOpen = !CopUi.trkViewOpen; copRerender(); });
  root.querySelectorAll("input[data-tcol]").forEach((cb) => cb.addEventListener("change", () => {
    const id = cb.dataset.tcol, t = copTrkPrefs();
    if (id === "@flow") t.flow = cb.checked;
    else { t.off = t.off.filter((x) => x !== id); if (!cb.checked) { t.off.push(id); delete F[id]; if (sort.id === id) CopUi.trkSort = null; } }
    copSetTrkPrefs(t); copRerender();
  }));
  const vr = $("#copTrkViewReset");
  if (vr) vr.addEventListener("click", () => { copSetTrkPrefs({ off: [], flow: true }); copRerender(); });
  const vrec = $("#copTrkViewRec");
  if (vrec) vrec.addEventListener("click", () => { copSetTrkPrefs(null); copRerender(); });
  const sortBy = (id) => { CopUi.trkSort = sort.id === id ? { id, dir: -sort.dir } : { id, dir: 1 }; copRerender(); };
  root.querySelectorAll(".copx-trk th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => sortBy(th.dataset.sort));
    th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortBy(th.dataset.sort); } });
  });
  let ft = null;
  root.querySelectorAll(".copx-trk .copx-cf").forEach((inp) => {
    const id = inp.dataset.cf;
    const apply = () => {
      F[id] = inp.value; copRerender();
      if (inp.tagName === "INPUT") {
        const n = document.querySelector(`.copx-trk .copx-cf[data-cf="${CSS.escape(id)}"]`);
        if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
      }
    };
    if (inp.tagName === "SELECT") inp.addEventListener("change", apply);
    else inp.addEventListener("input", () => { clearTimeout(ft); ft = setTimeout(apply, 300); });
  });
  // keep the filter row pinned just under the header row
  const hd = root.querySelector(".copx-trk tr.hd");
  if (hd) requestAnimationFrame(() => root.querySelectorAll(".copx-trk tr.flt th").forEach((th) => { th.style.top = hd.offsetHeight + "px"; }));
  root.querySelectorAll(".copx-trk tr.row").forEach((tr) => tr.addEventListener("click", (e) => {
    if (e.target.closest("a,button")) return;
    const w = tr.dataset.w;
    CopUi.view = tr.dataset.act === "1" ? "active" : "closed";
    Object.assign(CopUi, { q: "", poc: "", atRisk: false, quick: "", hit: "", rddDays: 0, focus: w });
    CopUi.expanded.add(w);
    copRerender();
    requestAnimationFrame(() => {
      const row = document.querySelector(`.copx-tbl tr.row[data-w="${CSS.escape(w)}"]`);
      if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }));
  copWireOpenLinks(root);
  $("#copTrkExport").addEventListener("click", () => {
    try { copExportTracker(shown, cols); } catch (e) { console.error(e); alert("Export failed: " + (e.message || e)); }
  });
}

/** Tracker view -> .xlsx (the rows and columns on screen, plain values). */
function copExportTracker(rows, cols) {
  const head = ["Status"], pick = [(x) => x.r.status];
  for (const c of cols) {
    head.push(c.xl || c.label.replace("’", "'")); pick.push(c.ex);
    if (c.exx) { head.push(c.xl2 || c.label.replace("’", "'") + " — status"); pick.push(c.exx); }
  }
  const aoa = [head];
  for (const x of rows) aoa.push(pick.map((f) => f(x) || ""));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = head.map((h) => ({ wch: /update$|notes/i.test(h) ? 60 : /WMTR/.test(h) ? 26 : /Route/.test(h) ? 30 : 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tracker");
  pmrDownloadXlsxB64(XLSX.write(wb, { type: "base64", bookType: "xlsx" }), `Shipping_Tracker_${fileStamp()}.xlsx`);
}
/* Small chain-link mark for consolidated shipments (teal, like the hover's consol line). */
const COP_CONSOL_ICON = `<span class="cl" title="Consol" aria-hidden="true"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg></span>`;

/** Only today's daily update is still outstanding (no earlier days missed). */
function copDueTodayOnly(r) { return !!(r.daily && r.daily.dueToday && !r.daily.missed.length); }

/** The four-step board: an oval WMTR tag per shipment. */
function copBoard(base, rows) {
  const shown = new Set(rows.map((r) => r.wmtr));
  const tag = (r) => {
    const nd = r.daily.missed.length;
    return `<button type="button" class="copx-bub ${r.health === "red" ? "red" : r.health === "amber" ? "amber" : ""} ${copDueTodayOnly(r) ? "due" : ""} ${CopUi.focus === r.wmtr ? "sel" : ""}"
      data-w="${esc(r.wmtr)}" aria-label="${esc(r.wmtr + " — " + r.status + (r.consol.length ? " — consol" : ""))}"${shown.has(r.wmtr) ? "" : ' style="opacity:.25"'}>${esc(r.last5)}${r.consol.length ? COP_CONSOL_ICON : ""}${
      r.problem ? `<span class="bang" aria-hidden="true">!</span>` : nd ? `<span class="nd" aria-hidden="true">${nd > 99 ? "99+" : nd}</span>` : ""}</button>`;
  };
  // Oldest in its current status first (blank dates last), then WMTR number.
  const sortB = (a, b) => copCmp(a.statusSince ? a.statusSince.getTime() : null, b.statusSince ? b.statusSince.getTime() : null) || a.num - b.num;
  const tally = (xs) => {
    const r = xs.filter((x) => x.health === "red").length, a = xs.filter((x) => x.health === "amber").length;
    return (r ? `<span class="r"><b>${r}</b> missed</span>` : "") + (a ? `<span class="a"><b>${a}</b> attention</span>` : "");
  };
  const board = el(`<div class="copx-board"></div>`);
  for (const s of COP_STEPS) {
    const xs = base.filter((r) => r.step === s.id).sort(sortB);
    let body;
    if (s.id === "exec" || COP_STEP_SUBS[s.id]) {
      const exec = s.id === "exec";
      body = (exec ? COP_EXEC_PHASES : COP_STEP_SUBS[s.id]).map((p) => {
        const ps = xs.filter((r) => (exec ? r.phase : r.sub) === p.id);
        if (!copShowSub(p, ps.length)) return "";
        return `<div class="copx-ph"><div class="pl"><span>${esc(p.label)}</span><span>${ps.length}</span></div>
          <div class="bb">${ps.length ? ps.map(tag).join("") : `<span class="copx-empty">None</span>`}</div></div>`;
      }).join("") || `<span class="copx-empty">None</span>`;
    } else body = xs.length ? xs.map(tag).join("") : `<span class="copx-empty">None</span>`;
    board.appendChild(el(`<div class="copx-col ${s.id}">
      <div class="ch" title="${esc(s.sub)}"><div class="t">${esc(s.label)}</div>
        <span class="cnt" title="${xs.length} WMTR${xs.length === 1 ? "" : "s"} in this step">${xs.length}</span></div>
      ${tally(xs) ? `<div class="tally">${tally(xs)}</div>` : ""}
      <div class="cb ${COP_STEP_SUBS[s.id] ? "subs" : ""}">${body}</div></div>`));
  }
  const unplaced = base.filter((r) => !r.step);
  if (unplaced.length) board.appendChild(el(`<div class="copx-msg" style="grid-column:1 / -1"><span class="copx-red">${copPlural(unplaced.length, "shipment")}</span> with a status the COP doesn't know: ${unplaced.map((r) => esc(r.last5 + " (" + r.status + ")")).join(", ")}.</div>`));
  return board;
}

/* Closed audit: each metric hit in a few words, for the Audit column.
   [{ cls: "r" | "a", cat: filter category, text }] — missing documents are
   grouped into one line. Acknowledged and not-scored items are left out. */
const COP_DOC_SHORT = { civ: "CIV", pkl: "PL", sli: "SLI", aes: "AES", vat: "VAT", pod: "POD", mct: "MCT" };
function copAuditItems(r) {
  const hits = r.checks.filter((c) => c.state === "fail" || c.state === "warn" || c.state === "due");
  const out = [];
  const docs = hits.filter((c) => /^doc\./.test(c.id));
  if (docs.length) out.push({ cls: docs.some((c) => c.state === "fail") ? "r" : "a", cat: "Missing documents",
    text: "Missing docs: " + docs.map((c) => COP_DOC_SHORT[c.id.slice(4)] || c.label.replace(/ attached.*$/, "")).join(", ") });
  const cut = (t) => String(t || "").replace(/^Acknowledged — /, "").replace(/\.\s*$/, "");
  for (const c of hits) {
    if (/^doc\./.test(c.id)) continue;
    const cls = c.state === "fail" ? "r" : "a";
    const d = cut(c.detail);
    let m;
    switch (c.id) {
      case "daily": {
        m = /^(\d+) business days?/.exec(d);
        out.push({ cls, cat: "Daily updates", text: m ? `Daily updates: ${m[1]} day${m[1] === "1" ? "" : "s"} missed` : "Daily updates missed" }); break;
      }
      case "rfq":
        m = /^Sent (\S+), after the (\S+) due date/.exec(d);
        out.push({ cls, cat: "RFQ", text: m ? `RFQ late: sent ${m[1]} (due ${m[2]})` : /due (\S+)/.test(d) ? `RFQ Sent Date blank (was due ${/due (\S+)/.exec(d)[1]})` : "RFQ Sent Date blank" }); break;
      case "packed":
        out.push({ cls, cat: "Date Packed", text: "Date Packed blank" }); break;
      case "awb":
        out.push({ cls, cat: "AWB / carrier", text: d.replace(/^Missing: /, "Missing ") }); break;
      case "itn":
        out.push({ cls, cat: "AES / ITN", text: "AES / ITN: " + d.replace(/ —.*$/, "") }); break;
      case "marad":
        m = /Was due (\S+)/.exec(d);
        out.push({ cls, cat: "MARAD", text: m ? `MARAD not submitted (due ${m[1]})` : "MARAD: " + d }); break;
      case "late":
        m = /delivered (\S+), RDD (\S+)/.exec(d);
        out.push({ cls, cat: "Delivered after RDD", text: m ? `Delivered after RDD (${m[1]} vs ${m[2]})` : "Delivered after RDD" }); break;
      case "deldate":
        out.push({ cls, cat: "Delivery Date", text: "Delivery Date blank" }); break;
      case "cost":
        out.push({ cls, cat: "Cost variance", text: d.replace(/ \(approved.*$/, "") }); break;
      case "rejected":
        out.push({ cls, cat: "Rejected in review", text: "Rejected in review" }); break;
      case "manual":
        out.push({ cls, cat: "Manual flag", text: d }); break;
      case "rti": case "invoiced":
        out.push({ cls, cat: "Invoicing", text: d }); break;
      default:
        out.push({ cls, cat: c.label, text: c.label });
    }
  }
  return out;
}

/* ---- table columns: sortable, filterable, and chosen per view (prefs.cols) ----
   Each column: id, label, sort(r) → number|string|null, fv(r) → the value its
   filter matches ("text" = contains box, otherwise a pick-list of the values
   in view), td(r) → cell HTML, opt: true = off until picked under Columns,
   fixed: true = always shown. */
const COP_HEALTH_ORDER = { red: 0, amber: 1, green: 2 };
function copTrkDate(v) { const d = copIsoToDate(v); return d ? d : null; }
function copTrkText(v) { const d = copIsoToDate(v); return d ? copFmt(d) : norm(v || ""); }
function copColDefs(isActive) {
  const muted = (s) => `<small style="color:var(--ax-muted)">${s}</small>`;
  const dateCol = (id, label, get, opt) => ({ id, label, opt, ft: "text",
    sort: (r) => { const d = get(r); return d ? d.getTime() : null; },
    fv: (r) => { const d = get(r); return d ? copFmt(d) : ""; },
    td: (r) => { const d = get(r); return `<td class="nw">${d ? esc(copFmt(d)) : "—"}</td>`; } });
  const textCol = (id, label, get, opt, ft) => ({ id, label, opt, ft,
    sort: (r) => copLow(get(r)) || null, fv: (r) => get(r) || "",
    td: (r) => `<td>${esc(get(r) || "—")}</td>` });
  const health = { id: "health", label: "", fixed: true, title: "Health",
    sort: (r) => COP_HEALTH_ORDER[r.health], td: (r) => `<td><span class="copx-dot ${r.health === "red" ? "red" : r.health === "amber" ? "amber" : ""}"></span></td>` };
  const wmtr = { id: "wmtr", label: "WMTR", fixed: true, ft: "text", sort: (r) => r.num, fv: (r) => r.wmtr,
    td: (r) => `<td class="w">${copWmtrLink(r, r.last5)}${isActive && r.consol.length ? ` <span class="copx-pill t" title="Consolidated with ${esc(r.consol.join(", "))}">Consol</span>` : ""}<small>${esc(r.wmtr)}</small></td>` };
  const poc = textCol("poc", "TTI POC", (r) => r.poc);
  poc.td = (r) => `<td class="nw">${esc(r.poc || "—")}</td>`;
  const route = { id: "route", label: "Origin / Destination", ft: "text",
    sort: (r) => copLow(r.dest) || null, fv: (r) => `${r.origin} → ${r.dest} ${r.mode}`,
    td: (r) => `<td class="nw">${esc(r.origin || "—")}<br>→ ${esc(r.dest || "—")}${r.mode ? `<br>${muted(esc(r.mode))}` : ""}</td>` };
  const items = isActive ? { id: "items", label: "Open Items",
    sort: (r) => -(r.counts.red * 1000 + r.counts.amber),
    fv: (r) => r.counts.red ? "Missed" : r.counts.amber ? "Needs attention" : "Clear",
    td: (r) => `<td>${r.counts.red ? `<span class="copx-pill r">${r.counts.red} missed</span>` : ""}${r.counts.amber ? `<span class="copx-pill a">${r.counts.amber} attention</span>` : ""}${!r.counts.red && !r.counts.amber ? `<span class="copx-pill g">Clear</span>` : ""}</td>` }
  : { id: "items", label: "Audit",
    sort: (r) => -(r.counts.red * 1000 + r.counts.amber),
    // pick-list of hit kinds; a row matches if it has that kind
    fvList: (r) => { const xs = copAuditItems(r); return xs.length ? Array.from(new Set(xs.map((x) => x.cat))) : ["Clear"]; },
    td: (r) => { const xs = copAuditItems(r);
      return `<td class="aud">${xs.length ? xs.map((x) => `<div class="${x.cls === "r" ? "copx-red" : "copx-amber"}">${esc(x.text)}</div>`).join("") : `<span class="copx-pill g">Clear</span>`}</td>`; } };
  const rddCat = (r) => !r.rdd ? "No RDD" : r.rddDays === null ? "Delivered" : r.rddDays < 0 ? "Past RDD" : r.rddDays <= 7 ? "Within 7 days" : r.rddDays <= 30 ? "8–30 days" : "More than 30 days";
  const rdd = { id: "rdd", label: "RDD", opt: true, sort: (r) => r.rdd ? r.rdd.getTime() : null, fv: rddCat,
    td: (r) => {
      // Coloured only when the RDD is monitored in ATLAS — otherwise it's just a date.
      const cls = !isActive || !r.rddWatch || r.rddDays === null ? "" : r.rddDays < 0 ? "copx-red" : r.rddDays <= 7 ? "copx-amber" : "";
      return `<td class="nw ${cls}">${r.rdd ? esc(copFmt(r.rdd)) : "—"}${isActive && r.rddDays !== null ? `<br><small class="d" style="color:var(--ax-muted)">${r.rddDays < 0 ? `${-r.rddDays}d past` : `${r.rddDays}d`}</small>` : ""}</td>`;
    } };
  // Reference fields — off by default, picked under Columns.
  const extras = [
    textCol("title", "Request Title", (r) => r.title, true, "text"),
    textCol("requestor", "Requestor", (r) => r.requestor, true),
    textCol("program", "CTR Program", (r) => r.program, true),
    textCol("mode", "Mode", (r) => r.mode, true),
    textCol("carrier", "Carrier", (r) => r.carrier, true),
    textCol("awb", "AWB/BoL #", (r) => r.awb, true, "text"),
    dateCol("etd", "Est. Departure", (r) => xtParseDate(r.rec.ship["departure from origin est. date"]), true),
    { id: "cost", label: "Total Cost", opt: true, ft: "text",
      sort: (r) => toFloat(r.rec.f["total cost in usd"]) || null, fv: (r) => copMoney(toFloat(r.rec.f["total cost in usd"])) || "",
      td: (r) => `<td class="nw">${esc(copMoney(toFloat(r.rec.f["total cost in usd"])) || "—")}</td>` },
  ];
  // Shipment-milestone fields (ATLAS Shipping Activity & History).
  const trkCol = (id, label, key, ft) => ({ id, label, opt: true, ft: ft || "text", title: "ATLAS Shipping Activity field",
    sort: (r) => { const v = r.trk && r.trk[key]; const d = copTrkDate(v); return d ? d.getTime() : (norm(v || "") ? copLow(v) : null); },
    fv: (r) => r.trk ? copTrkText(r.trk[key]) : "",
    td: (r) => `<td class="nw">${r.trk && norm(r.trk[key] || "") ? esc(copTrkText(r.trk[key])) : "—"}</td>` });
  if (isActive) {
    const step = { id: "step", label: "Step / Status",
      sort: (r) => `${r.stepIdx + 1}|${copLow(r.status)}`, fv: (r) => r.status || "",
      td: (r) => `<td class="st">${esc(r.step ? COP_STEPS[COP_STEP_IDX[r.step]].label : "—")}<small>${r.problem ? `<span class="copx-red">${esc(r.status)}</span>` : esc(r.status)}</small></td>` };
    // Where the daily updates stand, as a small bubble beside the date (was its own "Daily" column).
    const dWord = (r) => (r.relief || []).some((x) => x.code === "DAILY" || x.code === "ALL") ? "Relieved"
      : r.daily.missed.length ? "Missing" : r.daily.dueToday ? "Due today" : "Current";
    const dTag = (r) => { const w = dWord(r), n = r.daily.missed.length;
      return w === "Missing" ? `<span class="copx-pill r" title="${esc(`No update on ${copPlural(n, "business day")}: ${xtFmtDayList(r.daily.missed.slice(-5))}`)}">Missing${n > 1 ? ` ${n}` : ""}</span>`
        : `<span class="copx-pill ${w === "Current" ? "g" : w === "Relieved" ? "t" : "p"}">${w}</span>`; };
    const upd = { id: "update", label: "Latest Daily Update", ft: "text",
      sort: (r) => { const u = copUpdatesFor(r)[0]; return u ? u.date.getTime() : null; },
      fv: (r) => { const u = copUpdatesFor(r)[0]; return dWord(r) + " " + (u ? copFmt(u.date) + " " + u.note : ""); },
      td: (r) => { const lu = copUpdatesFor(r)[0];
        return `<td class="up"><span class="d">${lu ? esc(copFmt(lu.date)) : "No updates yet"} ${dTag(r)}${lu && lu.pending ? ' <b class="copx-amber">pending</b>' : ""}</span>${lu ? `<span class="x">${esc(lu.note)}</span>` : ""}</td>`; } };
    const days = { id: "days", label: "Days in Step", opt: true, ft: "text",
      sort: (r) => r.daysInStep, fv: (r) => r.daysInStep === null ? "" : String(r.daysInStep),
      td: (r) => `<td class="nw ${r.stuck === "fail" ? "copx-red" : r.stuck === "warn" ? "copx-amber" : ""}">${r.daysInStep === null ? "—" : r.daysInStep}</td>` };
    return [health, wmtr, step, poc, upd, rdd, route, items, days].concat(extras,
      [trkCol("packed", "Date Packed", "packed"), trkCol("rfq", "RFQ Sent", "rfq"), trkCol("itn", "ITN", "itn")]);
  }
  const status = textCol("status", "Status", (r) => r.status, true);      // nearly always "Invoiced": off unless picked under Columns
  status.td = (r) => `<td class="st">${esc(r.status)}</td>`;
  const delivered = dateCol("delivered", "Delivered", (r) => r.delivered);
  return [health, wmtr, status, poc, delivered, route, items, rdd].concat(extras,
    [trkCol("rfq", "RFQ Sent", "rfq"), trkCol("itn", "ITN", "itn")]);
}
/** Column ids shown in this view (prefs.cols, else the defaults). */
function copVisibleCols(isActive) {
  const defs = copColDefs(isActive);
  const saved = (copGetPrefs().cols || {})[isActive ? "active" : "closed"];
  const on = Array.isArray(saved) ? new Set(saved) : null;
  return defs.filter((c) => c.fixed || (on ? on.has(c.id) : !c.opt));
}
function copTblState(isActive) {
  CopUi.tbl = CopUi.tbl || {};
  const k = isActive ? "active" : "closed";
  return CopUi.tbl[k] || (CopUi.tbl[k] = { sort: "", dir: 1, f: {} });
}
/** Column filters (applied with the other filters, so the board fades too). */
function copApplyColFilters(rows, isActive) {
  const st = copTblState(isActive);
  const cols = copVisibleCols(isActive);
  for (const c of cols) {
    const v = st.f[c.id];
    if (!v || !(c.fv || c.fvList)) continue;
    rows = c.fvList ? rows.filter((r) => c.fvList(r).indexOf(v) !== -1)
      : c.ft === "text" ? rows.filter((r) => copLow(c.fv(r)).includes(copLow(v))) : rows.filter((r) => c.fv(r) === v);
  }
  return rows;
}
function copCmp(a, b) {
  if (a === null || a === undefined || a === "") return (b === null || b === undefined || b === "") ? 0 : 1;   // blanks last
  if (b === null || b === undefined || b === "") return -1;
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** Columns picker (the "Columns" button). */
function copColumnPicker(isActive) {
  const defs = copColDefs(isActive).filter((c) => !c.fixed);
  const vis = new Set(copVisibleCols(isActive).map((c) => c.id));
  const box = (c) => `<label class="copx-chk"><input type="checkbox" data-col="${esc(c.id)}" ${vis.has(c.id) ? "checked" : ""}> ${esc(c.label)}</label>`;
  return el(`<div class="copx-colpick">
    <div><div class="k">Default columns</div>${defs.filter((c) => !c.opt).map(box).join("")}</div>
    <div><div class="k">More columns</div>${defs.filter((c) => c.opt).map(box).join("")}</div>
    <div class="ft"><button class="lnk" type="button" id="copColsReset">Reset to default columns</button></div>
  </div>`);
}

/** Details table (active) or audit table (closed). */
function copTable(rows, isActive, base) {
  const wrap = el(`<div class="copx-tbl"></div>`);
  if (!base.length) {
    wrap.appendChild(el(`<p class="copx-msg">${isActive ? "No active shipments." : "No closed shipments in this UDQ."}</p>`));
    return wrap;
  }
  const cols = copVisibleCols(isActive);
  const st = copTblState(isActive);
  const ncol = cols.length;
  const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(t)}</option>`;
  const head = cols.map((c) => {
    const on = st.sort === c.id;
    const arrow = on ? (st.dir > 0 ? "▲" : "▼") : "";
    return `<th${c.sort ? ` class="srt${on ? " on" : ""}" data-sort="${esc(c.id)}" tabindex="0" aria-sort="${on ? (st.dir > 0 ? "ascending" : "descending") : "none"}"` : ""} title="${esc(c.title || (c.sort ? "Click to sort" : ""))}">${esc(c.label)}${arrow ? ` <span class="ar">${arrow}</span>` : ""}</th>`;
  }).join("");
  const fil = cols.map((c) => {
    if (!c.fv && !c.fvList) return "<th></th>";
    const v = st.f[c.id] || "";
    if (c.ft === "text") return `<th><input type="search" class="copx-cf" data-cf="${esc(c.id)}" value="${esc(v)}" placeholder="Filter" aria-label="Filter ${esc(c.label)}"></th>`;
    const vals = Array.from(new Set(base.flatMap((r) => c.fvList ? c.fvList(r) : [c.fv(r)]).filter(Boolean)));
    if (v && vals.indexOf(v) === -1) vals.push(v);
    vals.sort((a, b) => copCmp(a, b));
    return `<th><select class="copx-cf" data-cf="${esc(c.id)}" aria-label="Filter ${esc(c.label)}">${opt("", "All", !v)}${vals.map((x) => opt(x, x, x === v)).join("")}</select></th>`;
  }).join("");
  const table = el(`<table><thead><tr class="hd">${head}</tr><tr class="flt">${fil}</tr></thead><tbody></tbody></table>`);
  const tb = table.querySelector("tbody");
  let sorted;
  const sc = st.sort && cols.find((c) => c.id === st.sort);
  if (sc) sorted = rows.slice().sort((a, b) => {
    const va = sc.sort(a), vb = sc.sort(b);
    const blank = (x) => x === null || x === undefined || x === "";
    if (blank(va) || blank(vb)) return copCmp(va, vb) || a.num - b.num;     // blanks last either way
    return st.dir * copCmp(va, vb) || a.num - b.num;
  });
  else sorted = rows.slice().sort(isActive
    ? (a, b) => (b.stepIdx - a.stepIdx) || (COP_HEALTH_ORDER[a.health] - COP_HEALTH_ORDER[b.health]) || a.num - b.num
    : (a, b) => b.num - a.num);
  for (const r of sorted) {
    const tr = el(`<tr class="row ${CopUi.focus === r.wmtr ? "sel" : ""}" data-w="${esc(r.wmtr)}">${cols.map((c) => c.td(r)).join("")}</tr>`);
    tb.appendChild(tr);
    if (CopUi.expanded.has(r.wmtr)) tb.appendChild(copDetailRow(r, ncol, isActive));
  }
  if (!rows.length) tb.appendChild(el(`<tr><td colspan="${ncol}" class="copx-msg">No shipments match these filters.</td></tr>`));
  wrap.appendChild(table);
  return wrap;
}

/** Sorting, column filters and the Columns picker. */
function copWireTable(root, isActive) {
  const st = copTblState(isActive);
  const sortBy = (id) => { if (st.sort === id) st.dir = -st.dir; else { st.sort = id; st.dir = 1; } copRerender(); };
  root.querySelectorAll(".copx-tbl th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => sortBy(th.dataset.sort));
    th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortBy(th.dataset.sort); } });
  });
  let t = null;
  root.querySelectorAll(".copx-cf").forEach((inp) => {
    const id = inp.dataset.cf;
    const apply = () => {
      st.f[id] = inp.value; copRerender();
      if (inp.tagName === "INPUT") {
        const n = document.querySelector(`.copx-cf[data-cf="${CSS.escape(id)}"]`);
        if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
      }
    };
    if (inp.tagName === "SELECT") inp.addEventListener("change", apply);
    else inp.addEventListener("input", () => { clearTimeout(t); t = setTimeout(apply, 300); });
  });
  // keep the filter row pinned just under the header row
  const hd = root.querySelector(".copx-tbl tr.hd");
  if (hd) requestAnimationFrame(() => root.querySelectorAll(".copx-tbl tr.flt th").forEach((th) => { th.style.top = hd.offsetHeight + "px"; }));
  const cb = root.querySelector("#copCols");
  if (cb) cb.addEventListener("click", () => { CopUi.colsOpen = !CopUi.colsOpen; copRerender(); });
  const k = isActive ? "active" : "closed";
  root.querySelectorAll(".copx-colpick input[data-col]").forEach((c) => c.addEventListener("change", () => {
    const p = copGetPrefs();
    p.cols = (p.cols && typeof p.cols === "object") ? p.cols : {};
    p.cols[k] = Array.from(root.querySelectorAll(".copx-colpick input[data-col]")).filter((x) => x.checked).map((x) => x.dataset.col);
    if (!c.checked) { delete st.f[c.dataset.col]; if (st.sort === c.dataset.col) st.sort = ""; }
    copSetPrefs(p); copRerender();
  }));
  const cr = root.querySelector("#copColsReset");
  if (cr) cr.addEventListener("click", () => { const p = copGetPrefs(); if (p.cols) delete p.cols[k]; copSetPrefs(p); st.f = {}; st.sort = ""; copRerender(); });
}

/** Expanded row: request + last 10 daily updates | steps in order | throughout. */
function copDetailRow(r, ncol, isActive) {
  const curGroup = isActive && r.step ? r.step : "";
  const card = (g) => {
    const cs = r.checks.filter((c) => g.stages.indexOf(c.stage) !== -1);
    if (!cs.length) return "";
    const items = cs.map((c) => {
      const s = copStateMeta(c.state);
      const btn = (c.state === "fail" || c.state === "warn" || c.state === "due")
        ? `<button class="copx-ack" type="button" data-ack="${esc(c.ackKey)}" data-req="${esc(r.reqNo)}" title="Reviewed — not a miss">Acknowledge</button>`
        : c.state === "ack" ? `<button class="copx-ack" type="button" data-unack="${esc(c.ackKey)}" data-req="${esc(r.reqNo)}">Undo</button>` : "<span></span>";
      const cls = ["todo", "late", "incomplete"].indexOf(c.state) !== -1 ? c.state : s.cls;
      return `<li class="s-${cls}" title="${esc(s.word)}"><span class="ic">${s.icon}</span><span class="lb">${esc(c.label)}</span>${btn}<span class="dt">${esc(s.word)} — ${esc(c.detail)}</span></li>`;
    }).join("");
    return `<div class="copx-stp ${curGroup === g.id ? "cur" : ""}"><h4><span>${esc(g.label)}</span><span>${curGroup === g.id ? "current step" : ""}</span></h4><ul>${items}</ul></div>`;
  };
  const steps = COP_GROUPS.filter((g) => g.id !== "general").map(card).join("");
  const general = card(COP_GROUPS.find((g) => g.id === "general"));
  const log = copUpdatesFor(r).slice(0, 10)
    .map((d) => `<div><span>${esc(copFmt(d.date))}</span>${d.pending ? '<b class="copx-amber">pending · </b>' : ""}${esc(d.note)}</div>`).join("");
  const link = r.tracklink && /^https?:\/\//i.test(r.tracklink) ? ` · <a href="${esc(r.tracklink)}" target="_blank" rel="noopener">Track</a>` : "";
  return el(`<tr class="copx-det"><td colspan="${ncol}"><div class="copx-det-grid">
    <div class="copx-info">
      ${isActive && copCanEdit() ? copUpdateForm(r) : ""}
      <div><div class="k">Request</div>${copWmtrLink(r, r.wmtr)}<br>${esc(r.title || "")}</div>
      <div><div class="k">Route</div>${esc(r.origin || "?")} → ${esc(r.dest || "?")}${r.mode ? ` · ${esc(r.mode)}` : ""}</div>
      <div><div class="k">Carrier / AWB-BoL</div>${esc(r.carrier || "—")} · ${esc(r.awb || "—")}${link}</div>
      ${r.rdd || isActive ? `<div><div class="k">RDD</div>${r.rdd ? esc(copFmt(r.rdd)) : "—"}
        ${isActive && r.rddWatch ? ` <span class="copx-pill b" title="Monitor this RDD is ticked in ATLAS">Monitored</span>` : ""}</div>` : ""}
      ${r.consol && r.consol.length ? `<div><div class="k">Consolidated with</div>${esc(r.consol.join(", "))}</div>` : ""}
      ${r.relief && r.relief.length ? `<div><div class="k">Relieved</div>${r.relief.map((x) => `<span class="copx-pill t">${esc(x.code)}</span> ${esc(x.reason || "")}`).join("<br>")}</div>` : ""}
      <div class="log"><div class="k">Recent daily updates${copUpdatesFor(r).length > 10 ? ` <button class="lnk" type="button" data-hist="${esc(r.wmtr)}">All ${copUpdatesFor(r).length}</button>` : ""}</div>${log || "<div>None yet.</div>"}</div>
    </div>
    <div class="copx-steps">${steps}</div>
    <div class="copx-steps">${general}</div>
  </div></td></tr>`);
}

/* ---- hover card: latest update, daily status (with the missing days), open items ---- */
function copHoverEl() {
  let h = document.getElementById("copHover");
  if (!h) { h = document.createElement("div"); h.id = "copHover"; document.body.appendChild(h); }
  return h;
}
function copHoverHtml(r) {
  const open = r.checks.filter((c) => c.state === "fail" || c.state === "warn")
    .sort((a, b) => copStateMeta(a.state).rank - copStateMeta(b.state).rank);
  const miss = r.daily.missed || [];
  const shown = miss.slice(-8);
  const dailyLine = miss.length
    ? `<div class="bad">⚠ Missing ${copPlural(miss.length, "daily update")}: ${esc(xtFmtDayList(shown))}${miss.length > shown.length ? " (latest 8)" : ""}</div>`
    : r.daily.dueToday ? `<div style="color:var(--ax-purple,#7b4fc9);font-weight:600">● Today's daily update isn't in yet.</div>` : `<div class="ok">✓ Daily updates current</div>`;
  const others = open.filter((c) => c.id !== "daily");
  return `<div class="h">${esc(r.last5)} · ${esc(r.status || "—")}</div>
    <div class="s">${esc(r.wmtr)}${r.poc ? " · " + esc(r.poc) : ""}</div>
    ${r.statusSince ? `<div class="s">In this status since ${esc(copFmt(r.statusSince))} (${copPlural(copBizDaysBetween(r.statusSince, copToday()), "business day")})</div>` : ""}
    ${r.consol && r.consol.length ? `<div class="k">Consol</div><div style="color:var(--ax-teal,#00838f);font-weight:600">${COP_CONSOL_ICON.replace('class="cl"', 'class="cl" style="margin:0 4px 0 0"')}Consolidated with ${esc(r.consol.join(", "))}</div>` : ""}
    <div class="k">Latest update</div>
    <div>${r.latest ? `<b>${esc(copFmt(r.latest.date))}</b> — ${esc(r.latest.note)}` : "No daily updates yet."}</div>
    <div class="k">Daily update</div>${dailyLine}
    ${(r.pending || []).length ? `<div class="s" style="margin:4px 0 0">${copPlural(r.pending.length, "update")} entered here, pending until in ATLAS</div>` : ""}
    <div class="k">Other open items</div>${others.length
      ? `<ul>${others.slice(0, 4).map((c) => `<li class="${c.state === "fail" ? "r" : "a"}">${esc(c.brief || c.label)}</li>`).join("")}</ul>${others.length > 4 ? `<div>…and ${others.length - 4} more</div>` : ""}`
      : `<div class="ok">None</div>`}`;
}

/* =========================================================================
   DAILY UPDATES FROM THE COP (2.6.3)
   The TTI POC can enter the day's status updates without leaving the COP:
   per shipment in its details, or for every shipment in view on the
   "Enter daily updates" sheet. copSaveDailyUpdate is the ONE place an update
   is written. In ATLAS it becomes the call that adds the entry to the
   request's Daily Status History (same as the "+ Add" button on the request
   page). The utility can't write to ATLAS, so here the entry is kept in this
   browser as "pending" and shown alongside the ATLAS history until the same
   date + note turns up in a later UDQ (then it's dropped automatically).
   Pending entries do NOT count toward the daily-update check — only ATLAS does.
   2.6.19: inside ATLAS, once ATLAS_UDQ_CONFIG.dailyStatus is filled in, Save
   writes to ATLAS (atlasPostDailyStatus) and the entry joins the request's
   ATLAS history straight away. Otherwise the Utility has no update entry.
   ========================================================================= */
/** Saving really goes to ATLAS (inside ATLAS, write-back API set up). */
function copAtlasWrites() { return typeof atlasDailyStatusOn === "function" && atlasDailyStatusOn(); }
/** Preview (2.6.20, temporary): Settings ▸ "Show COP daily-update entry & editing"
    — the mockup's browser-only behaviour, so it can be tried before the API exists. */
function copPreviewOn() {
  try { return typeof AtlasSettings !== "undefined" && !!AtlasSettings.get().copDailyPreview; } catch (e) { return false; }
}
/** Saves stay in this browser (mockup / preview), not sent to ATLAS. */
function copLocalUpdates() { return !copAtlasWrites() && (COP_MOCKUP.editUpdates || copPreviewOn()); }
/** Update entry is shown: the mockup, the preview, or inside ATLAS with the write-back API set up. */
function copCanEdit() {
  return COP_MOCKUP.editUpdates || copPreviewOn() || copAtlasWrites();
}
const COP_DRAFTS_KEY = "atlas.cop.dailydrafts";
function copGetDrafts() {
  try { const o = JSON.parse(localStorage.getItem(COP_DRAFTS_KEY) || "{}"); return (o && typeof o === "object") ? o : {}; }
  catch (e) { return {}; }
}
function copSetDrafts(o) {
  try { localStorage.setItem(COP_DRAFTS_KEY, JSON.stringify(o)); } catch (e) { /* storage off */ }
}
/** Write one daily status update. Inside ATLAS: POST it to the request's Daily
    Status History, then add it to the loaded history. Mockup: keep it as a
    pending entry in this browser. Throws if ATLAS doesn't save it. */
async function copSaveDailyUpdate(wmtr, dateIso, note, r) {
  if (copAtlasWrites()) {
    const id = copRequestId(r);
    if (!id) throw new Error(`${wmtr} has no ATLAS request ID in the data, so it can't be saved from here. Add the update on the request page.`);
    const entryId = await atlasPostDailyStatus(id, dateIso, String(note).trim());
    r.rec.daily.push({ date: xtParseDate(dateIso), note: String(note).trim(), id: entryId, created: new Date() });
    return;
  }
  const d = copGetDrafts();
  (d[wmtr] = d[wmtr] || []).push({ date: dateIso, note: String(note).trim(), at: new Date().toISOString() });
  copSetDrafts(d);
}

/* EDITING PAST UPDATES (2.6.20) — the History pop-up lets the TTI POC change an
   entry's date and notes, like the edit on the request page. Inside ATLAS this
   PUTs to ATLAS_UDQ_CONFIG.dailyStatus.editUrl using the entry's ID (dailyPOCList
   "id"); the mockup changes it in this page only (pending entries in the browser). */
/** This entry (from copUpdatesFor) can be edited here. */
function copCanEditEntry(x) {
  if (x.pending) return true;
  if (copAtlasWrites()) return !!(x.src && x.src.id) && atlasDailyStatusEditOn();
  return copLocalUpdates();
}
/** Change one entry's date + notes. Throws if ATLAS doesn't save it. */
async function copEditDailyUpdate(r, x, dateIso, note) {
  note = String(note).trim();
  if (x.pending) {
    const d = copGetDrafts();
    const e = (d[r.wmtr] || []).find((y) => y.at === x.at);
    if (e) { e.date = dateIso; e.note = note; copSetDrafts(d); r.pending = d[r.wmtr]; }
    return;
  }
  if (copAtlasWrites()) {
    if (!atlasDailyStatusEditOn()) throw new Error("Editing past updates isn't set up yet (no edit address in Settings).");
    const id = copRequestId(r);
    if (!id) throw new Error(`${r.wmtr} has no ATLAS request ID in the data. Edit it on the request page.`);
    await atlasPutDailyStatus(id, x.src.id, dateIso, note);
  }
  x.src.date = xtParseDate(dateIso);
  x.src.note = note;
}
function copDeleteDraft(wmtr, at) {
  const d = copGetDrafts();
  if (!d[wmtr]) return;
  d[wmtr] = d[wmtr].filter((x) => x.at !== at);
  if (!d[wmtr].length) delete d[wmtr];
  copSetDrafts(d);
}
/** Drop pending entries that have since shown up in ATLAS (same date + note). */
function copPruneDrafts(records) {
  const d = copGetDrafts();
  let changed = false;
  const key = (iso, note) => iso + "|" + copLow(note);
  for (const rec of records) {
    const list = d[rec.wmtr];
    if (!list) continue;
    const have = new Set(rec.daily.map((x) => key(xtIso(x.date), x.note)));
    const keep = list.filter((x) => !have.has(key(x.date, x.note)));
    if (keep.length !== list.length) { changed = true; if (keep.length) d[rec.wmtr] = keep; else delete d[rec.wmtr]; }
  }
  if (changed) copSetDrafts(d);
  return d;
}
/** Every update for a row, newest first: ATLAS entries + pending ones. */
function copUpdatesFor(r) {
  const atlas = ((r.rec && r.rec.daily) || []).map((x) => ({ date: x.date, note: x.note, pending: false, created: x.created, src: x }));
  const pend = (r.pending || []).map((x) => ({ date: xtParseDate(x.date), note: x.note, pending: true, at: x.at }));
  return atlas.concat(pend).filter((x) => x.date).sort((a, b) => (b.date - a.date) || (a.pending === b.pending ? 0 : a.pending ? -1 : 1));
}
function copUpdatedOn(r, iso) { return copUpdatesFor(r).some((x) => xtIso(x.date) === iso); }

/** The request's unique ATLAS ID ("Request ID" column — added to the fetched
    data once ATLAS_UDQ_CONFIG.dailyStatus.requestIdField is set). */
function copRequestId(r) {
  return (r && r.rec && (r.rec.f["request id"] || r.rec.f["requestid"] || r.rec.f["id"])) || "";
}
/** Link to the request in ATLAS (address pattern in ATLAS_UDQ_CONFIG.dailyStatus.requestUrl).
    Null until the data carries the request ID. */
function copRequestUrl(r) {
  const id = copRequestId(r);
  const pat = (typeof ATLAS_UDQ_CONFIG !== "undefined" && ATLAS_UDQ_CONFIG.dailyStatus && ATLAS_UDQ_CONFIG.dailyStatus.requestUrl) || "/wmtr/request/edit/{requestId}/SRF";
  return id ? pat.replace("{requestId}", encodeURIComponent(id)) : null;
}
/** The WMTR number, as a link to the request (mockup, or inside ATLAS when the
    data has the request ID — on atlas-utility.net it's plain text). */
function copWmtrLink(r, text) {
  const live = typeof AtlasLive !== "undefined" && AtlasLive.ok && copRequestUrl(r);
  if (!COP_MOCKUP.links && !live) return esc(text);
  const url = copRequestUrl(r);
  return `<a class="copx-open" href="${url ? esc(url) : "#"}" ${url ? 'target="_blank" rel="noopener"' : `data-noid="1"`}
    title="Open ${esc(r.wmtr)} in ATLAS">${esc(text)}</a>`;
}

/** The daily-update form + history link (shipment details, TTI view). */
function copUpdateForm(r) {
  const n = copUpdatesFor(r).length;
  return `<div class="copx-uform" data-w="${esc(r.wmtr)}">
    <div class="k g">Daily Status Update</div>
    <div class="row"><input type="date" class="copx-in" data-udate value="${esc(xtIso(copToday()))}" aria-label="Update date">
      <button class="copx-btn sm blue" type="button" data-usame title="Copy the last update into the box">Same as last</button></div>
    <textarea class="copx-in" data-unote rows="2" maxlength="1000" placeholder="Where is it today / what's next"></textarea>
    <div class="row"><button class="copx-btn sm addb" type="button" data-uadd>Save update</button>
      <button class="lnk" type="button" data-uhist>History (${n})</button></div>
  </div>`;
}

/** "Enter daily updates" sheet: every shipment in view, today's update in one place. */
function copUpdatesSheet(rows) {
  const iso = CopUi.updDate || xtIso(copToday());
  const done = rows.filter((r) => copUpdatedOn(r, iso)).length;
  const sorted = rows.slice().sort((a, b) => (copUpdatedOn(a, iso) - copUpdatedOn(b, iso)) || a.num - b.num);
  const wrap = el(`<div class="copx-sheet">
    <div class="copx-sheet-hd">
      <label>Update date <input type="date" class="copx-in" id="copUpdDate" value="${esc(iso)}"></label>
      <span class="copx-pill ${done === rows.length ? "g" : "b"}">${done} of ${rows.length} updated</span>
      <span class="copx-msg">${CopUi.msg ? `<b>${esc(CopUi.msg)}</b>` : !COP_MOCKUP.editUpdates && copLocalUpdates() ? "<b>Preview</b> — saved updates stay in this browser (pending) and aren't sent to ATLAS." : "Use the TTI POC filter above to show just your shipments."}</span>
      <button class="copx-btn addb" type="button" data-usave style="margin-left:auto">Save all updates</button>
    </div>
    <div class="copx-tbl"><table><thead><tr><th>WMTR</th><th>Status</th><th>Last update</th><th style="min-width:320px">Update for ${esc(copFmt(xtParseDate(iso)))}</th><th></th></tr></thead><tbody></tbody></table></div>
    <div class="copx-sheet-ft"><button class="copx-btn addb" type="button" data-usave>Save all updates</button></div>
  </div>`);
  const tb = wrap.querySelector("tbody");
  sorted.forEach((r, i) => {
    const ups = copUpdatesFor(r);
    const last = ups[0];
    const today = ups.find((x) => xtIso(x.date) === iso);
    tb.appendChild(el(`<tr class="${today ? "done" : ""}" data-w="${esc(r.wmtr)}">
      <td class="w">${copWmtrLink(r, r.last5)}<small>${esc(r.poc || "")}</small></td>
      <td class="st">${esc(r.status)}<small>${esc(r.dest || "")}</small></td>
      <td class="up">${last ? `<span class="d">${esc(copFmt(last.date))}${last.pending ? ' · <b class="copx-amber">pending</b>' : ""}</span><span class="x">${esc(last.note)}</span>` : `<span class="d">No updates yet</span>`}</td>
      <td>${today ? `<div class="copx-donebox">✓ ${esc(today.note)}${today.pending ? ' <b class="copx-amber">(pending)</b>' : ""}</div>` : ""}
        <textarea class="copx-in" data-unote data-i="${i}" rows="2" maxlength="1000" placeholder="${today ? "Add another update" : "Today's update"}">${esc((CopUi.sheetText || {})[r.wmtr] || "")}</textarea></td>
      <td class="nw"><button class="copx-btn sm blue" type="button" data-usame>Same as last</button>
        <button class="copx-btn sm addb" type="button" data-uone>Save</button>
        <button class="lnk" type="button" data-uhist>History (${ups.length})</button></td>
    </tr>`));
  });
  if (!rows.length) tb.appendChild(el(`<tr><td colspan="5" class="copx-msg">No shipments in view.</td></tr>`));
  return wrap;
}

/** ATLAS-style "Daily Status Activity" history pop-up. `edit` = the row being
    edited (index into the list); `msg` = a save result to show. */
function copShowHistory(r, edit, msg) {
  const ups = copUpdatesFor(r);
  const old = document.getElementById("copHist");
  if (old) old.remove();
  const hasCreated = ups.some((x) => x.created);
  const cols = 4 + (hasCreated ? 1 : 0);
  const row = (x, i) => {
    if (i === edit) return `<tr class="copx-hedit" data-i="${i}"><td class="nw"><input type="date" class="copx-in" data-hdate value="${esc(xtIso(x.date))}" aria-label="Update date"></td>
      <td colspan="${cols - 2}"><textarea class="copx-in" data-hnote rows="3" maxlength="1000" aria-label="Notes">${esc(x.note)}</textarea></td>
      <td class="nw"><button class="copx-btn sm addb" type="button" data-hsave>Save</button> <button class="copx-ack" type="button" data-hcancel>Cancel</button></td></tr>`;
    return `<tr><td class="nw">${esc(copFmt(x.date))}</td><td style="white-space:pre-wrap">${esc(x.note)}</td>
      ${hasCreated ? `<td class="nw">${x.created ? esc(copFmt(x.created)) : ""}</td>` : ""}
      <td class="nw">${x.pending ? '<span class="copx-pill a">Pending — not in ATLAS yet</span>' : '<span class="copx-pill g">ATLAS</span>'}</td>
      <td class="nw">${edit == null && copCanEditEntry(x) ? `<button class="copx-ack" type="button" data-hedit="${i}">Edit</button>` : ""}
        ${x.pending && edit == null ? `<button class="copx-ack" type="button" data-del="${esc(x.at)}">Delete</button>` : ""}</td></tr>`;
  };
  const m = el(`<div id="copHist" class="copx copx-modal-bg" role="dialog" aria-modal="true" aria-label="Daily Status Activity">
    <style>${COPX_CSS}</style>
    <div class="copx-modal">
      <div class="copx-modal-hd"><span>Daily Status Activity — ${esc(r.wmtr)}</span><button type="button" class="x" aria-label="Close">×</button></div>
      ${msg ? `<div class="copx-msg" style="padding:6px 14px"><b>${esc(msg)}</b></div>` : ""}
      <div class="copx-tbl" style="max-height:70vh"><table><thead><tr><th>Date</th><th>Notes</th>${hasCreated ? "<th>Entered</th>" : ""}<th>Source</th><th></th></tr></thead><tbody>
        ${ups.length ? ups.map(row).join("") : `<tr><td colspan="${cols}" class="copx-msg">No updates yet.</td></tr>`}
      </tbody></table></div>
    </div></div>`);
  document.body.appendChild(m);
  const close = () => { m.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  m.addEventListener("click", (e) => { if (e.target === m) close(); });
  m.querySelector(".x").addEventListener("click", close);
  const reopen = (ed, t) => { close(); copShowHistory(r, ed, t); };
  m.querySelectorAll("button[data-del]").forEach((b) => b.addEventListener("click", () => {
    copDeleteDraft(r.wmtr, b.dataset.del);
    r.pending = (copGetDrafts()[r.wmtr]) || [];
    reopen(); copRerender();
  }));
  m.querySelectorAll("button[data-hedit]").forEach((b) => b.addEventListener("click", () => reopen(Number(b.dataset.hedit))));
  const er = m.querySelector(".copx-hedit");
  if (er) {
    const ta = er.querySelector("[data-hnote]"), dt = er.querySelector("[data-hdate]");
    er.querySelector("[data-hcancel]").addEventListener("click", () => reopen());
    er.querySelector("[data-hsave]").addEventListener("click", async (e) => {
      const note = ta.value.trim(), iso = dt.value;
      if (!note || !iso) { (note ? dt : ta).focus(); return; }
      const x = ups[edit];
      if (note === x.note && iso === xtIso(x.date)) { reopen(); return; }
      e.target.disabled = true;
      try { await copEditDailyUpdate(r, x, iso, note); }
      catch (err) {
        console.error(err); e.target.disabled = false;
        const box = m.querySelector(".copx-hmsg") || er.insertAdjacentElement("afterend", el(`<tr class="copx-hmsg"><td colspan="${cols}" class="copx-msg"></td></tr>`));
        box.querySelector("td").innerHTML = `<b>Not saved — ${esc(err.message || err)}</b>`;
        return;
      }
      reopen(null, `Update for ${copFmt(xtParseDate(iso))} changed` +
        (!x.pending && !COP_MOCKUP.editUpdates && copLocalUpdates() ? " (preview — this page only, not sent to ATLAS)." : "."));
      copRerender();
    });
    requestAnimationFrame(() => ta.focus());
  } else m.querySelector(".x").focus();
}

/* =========================================================================
   REQUESTOR VIEW (2.6.3) — what a requestor sees: their active requests,
   where each one is, the latest update and who their TTI POC is. No flags,
   metrics or internal checks. In ATLAS it's the signed-in requestor's
   requests; here a Requestor picker stands in for the sign-in.
   ========================================================================= */
const COP_REQ_STEP_TEXT = {
  qr: "TTI is reviewing your request",
  review: "DTRA program & compliance review",
  estimate: "Cost estimate in preparation / DTRA estimate review",
};
const COP_REQ_PHASE_TEXT = {
  pre: "Approved — clearances and permits being arranged",
  booked: "Booked / picked up",
  transit: "In transit",
  customs: "At destination customs",
  delivery: "Out for delivery / delivered — confirming receipt",
};
function copReqStatusText(r) {
  if (r.step === "exec") return COP_REQ_PHASE_TEXT[r.phase] || "In progress";
  return COP_REQ_STEP_TEXT[r.step] || r.status || "—";
}
function copReqProgress(r) {
  const steps = [["qr", "TTI review"], ["review", "DTRA review"], ["estimate", "Estimate"], ["pre", "Clearance"], ["booked", "Picked up"], ["transit", "In transit"], ["customs", "Customs"], ["delivery", "Delivery"]];
  const cur = r.step === "exec" ? 3 + (COP_PHASE_IDX[r.phase] || 0) : COP_STEP_IDX[r.step] ?? -1;
  return `<div class="copx-prog">${steps.map(([, t], i) => `<div class="ps ${i < cur ? "done" : i === cur ? "cur" : ""}"><i></i><span>${esc(t)}</span></div>`).join("")}</div>`;
}

function copRenderRequestor(root, built) {
  const all = built.active;
  const names = Array.from(new Set(all.map((r) => r.requestor).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  if (CopUi.reqName && names.indexOf(CopUi.reqName) === -1) CopUi.reqName = "";
  const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(t)}</option>`;
  let rows = CopUi.reqName ? all.filter((r) => r.requestor === CopUi.reqName) : all;
  if (CopUi.q) { const q = copLow(CopUi.q); rows = rows.filter((r) => copLow(r.wmtr + " " + r.title + " " + r.dest + " " + r.status).includes(q)); }

  const card = el(`<section class="copx-card">
    <div class="copx-hd"><h2>My Requests</h2><span class="n">${copPlural(rows.length, "active request")}</span></div>
    <div class="copx-rule"></div>
    <div class="copx-frow req">
      <div class="copx-f"><label for="copReqName">Requestor</label><select id="copReqName">${opt("", "All requestors (preview)", !CopUi.reqName)}${names.map((n) => opt(n, n, n === CopUi.reqName)).join("")}</select></div>
      <div class="copx-f"><label for="copQ">Search</label><input type="search" id="copQ" placeholder="WMTR, title, country" value="${esc(CopUi.q)}"></div>
      <span class="copx-msg">In ATLAS this shows the signed-in requestor's requests; the picker stands in for that here.</span>
    </div>
  </section>`);
  root.appendChild(card);

  // board — same four steps, neutral tags
  const board = el(`<div class="copx-board"></div>`);
  const tag = (r) => `<button type="button" class="copx-bub neutral ${CopUi.focus === r.wmtr ? "sel" : ""}" data-w="${esc(r.wmtr)}" aria-label="${esc(r.wmtr)}">${esc(r.last5)}${r.consol.length ? COP_CONSOL_ICON : ""}</button>`;
  const subs = { qr: "TTI checks the request details", review: "DTRA program & export compliance", estimate: "Quotes, costs and DTRA approval", exec: "Clearance → pickup → delivery" };
  for (const s of COP_STEPS) {
    const xs = rows.filter((r) => r.step === s.id).sort((a, b) => a.num - b.num);
    const body = s.id === "exec"
      ? COP_EXEC_PHASES.map((p) => { const ps = xs.filter((r) => r.phase === p.id);
          if (!copShowSub(p, ps.length)) return "";
          return `<div class="copx-ph"><div class="pl"><span>${esc(COP_REQ_PHASE_TEXT[p.id].split(" — ")[0])}</span><span>${ps.length}</span></div><div class="bb">${ps.length ? ps.map(tag).join("") : `<span class="copx-empty">None</span>`}</div></div>`; }).join("")
      : (xs.length ? xs.map(tag).join("") : `<span class="copx-empty">None</span>`);
    board.appendChild(el(`<div class="copx-col ${s.id}"><div class="ch"><div class="t">${esc(s.label)}</div><div class="s">${esc(subs[s.id])}</div><span class="cnt">${xs.length}</span></div><div class="cb">${body}</div></div>`));
  }
  card.appendChild(board);

  // table
  const tcard = el(`<section class="copx-card"><div class="copx-hd"><h2>Request Details</h2><span class="n">Click a request for its progress and update history</span></div><div class="copx-rule"></div></section>`);
  root.appendChild(tcard);
  const wrap = el(`<div class="copx-tbl"></div>`);
  if (!rows.length) wrap.appendChild(el(`<p class="copx-msg">No active requests.</p>`));
  else {
    const table = el(`<table><thead><tr><th>Request</th><th>Title</th><th>Where it is</th><th>Latest Update</th><th>Destination</th><th>RDD</th><th>TTI POC</th></tr></thead><tbody></tbody></table>`);
    const tb = table.querySelector("tbody");
    for (const r of rows.slice().sort((a, b) => (b.stepIdx - a.stepIdx) || a.num - b.num)) {
      const last = copUpdatesFor(r).find((x) => !x.pending);
      tb.appendChild(el(`<tr class="row ${CopUi.focus === r.wmtr ? "sel" : ""}" data-w="${esc(r.wmtr)}">
        <td class="w">${copWmtrLink(r, r.last5)}<small>${esc(r.wmtr)}</small></td>
        <td style="max-width:260px">${esc(r.title)}</td>
        <td class="st">${esc(copReqStatusText(r))}<small>${esc(r.status)}</small></td>
        <td class="up">${last ? `<span class="d">${esc(copFmt(last.date))}</span><span class="x">${esc(last.note)}</span>` : `<span class="d">No updates yet</span>`}</td>
        <td>${esc(r.dest || "—")}<br><small style="color:var(--ax-muted)">${esc(r.mode || "")}</small></td>
        <td class="nw">${r.rdd ? esc(copFmt(r.rdd)) : "—"}</td>
        <td class="nw">${esc(r.poc || "—")}${r.pocEmail ? `<br><a href="mailto:${esc(r.pocEmail)}">${esc(r.pocEmail)}</a>` : ""}</td></tr>`));
      if (CopUi.expanded.has(r.wmtr)) {
        const log = copUpdatesFor(r).filter((x) => !x.pending).slice(0, 10).map((d) => `<div><span>${esc(copFmt(d.date))}</span>${esc(d.note)}</div>`).join("");
        const link = r.tracklink && /^https?:\/\//i.test(r.tracklink) ? ` · <a href="${esc(r.tracklink)}" target="_blank" rel="noopener">Track shipment</a>` : "";
        tb.appendChild(el(`<tr class="copx-det"><td colspan="7"><div class="copx-det-grid req">
          <div class="copx-info">
            <div><div class="k">Request</div>${copWmtrLink(r, r.wmtr)}<br>${esc(r.title)}</div>
            <div><div class="k">Route</div>${esc(r.origin || "?")} → ${esc(r.dest || "?")}${r.mode ? ` · ${esc(r.mode)}` : ""}</div>
            <div><div class="k">Carrier / AWB-BoL</div>${esc(r.carrier || "—")} · ${esc(r.awb || "—")}${link}</div>
            <div><div class="k">Your TTI POC</div>${esc(r.poc || "—")}${r.pocEmail ? ` · <a href="mailto:${esc(r.pocEmail)}">${esc(r.pocEmail)}</a>` : ""}${r.pocPhone ? ` · ${esc(r.pocPhone)}` : ""}</div>
          </div>
          <div class="copx-info"><div class="k">Progress</div>${copReqProgress(r)}
            <div class="log"><div class="k">Status updates</div>${log || "<div>None yet.</div>"}</div></div>
        </div></td></tr>`));
      }
    }
    wrap.appendChild(table);
  }
  tcard.appendChild(wrap);

  // wiring
  const $ = (s) => root.querySelector(s);
  $("#copReqName").addEventListener("change", (e) => { CopUi.reqName = e.target.value; copRerender(); });
  const q = $("#copQ"); let qt = null;
  q.addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(() => { CopUi.q = q.value; copRerender(); const nq = document.getElementById("copQ"); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } }, 250); });
  const byW = {}; for (const r of all) byW[r.wmtr] = r;
  const hover = copHoverEl();
  const move = (e) => { const pad = 16, w = hover.offsetWidth, h = hover.offsetHeight; let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > window.innerWidth - 8) x = Math.max(8, e.clientX - w - pad); if (y + h > window.innerHeight - 8) y = Math.max(8, e.clientY - h - pad);
    hover.style.left = x + "px"; hover.style.top = y + "px"; };
  root.querySelectorAll(".copx-bub").forEach((b) => {
    const r = byW[b.dataset.w]; if (!r) return;
    b.addEventListener("mouseenter", (e) => {
      const last = copUpdatesFor(r).find((x) => !x.pending);
      hover.innerHTML = `<div class="h">${esc(r.last5)} · ${esc(copReqStatusText(r))}</div><div class="s">${esc(r.title)}</div>
        ${r.consol && r.consol.length ? `<div class="k">Consol</div><div style="color:var(--ax-teal,#00838f);font-weight:600">Shipping together with ${esc(r.consol.join(", "))}</div>` : ""}
        <div class="k">Latest update</div><div>${last ? `<b>${esc(copFmt(last.date))}</b> — ${esc(last.note)}` : "No updates yet."}</div>
        <div class="k">Destination</div><div>${esc(r.dest || "—")}${r.rdd ? ` · RDD ${esc(copFmt(r.rdd))}` : ""}</div>`;
      hover.style.display = "block"; move(e); });
    b.addEventListener("mousemove", move);
    b.addEventListener("mouseleave", () => { hover.style.display = "none"; });
    b.addEventListener("click", () => { hover.style.display = "none"; CopUi.focus = r.wmtr; CopUi.expanded.add(r.wmtr); copRerender();
      requestAnimationFrame(() => { const tr = document.querySelector(`.copx-tbl tr.row[data-w="${CSS.escape(r.wmtr)}"]`); if (tr) tr.scrollIntoView({ behavior: "smooth", block: "center" }); }); });
  });
  root.querySelectorAll(".copx-tbl tr.row").forEach((tr) => tr.addEventListener("click", (e) => {
    if (e.target.closest("a,button")) return;
    const w = tr.dataset.w;
    if (CopUi.expanded.has(w)) CopUi.expanded.delete(w); else { CopUi.expanded.add(w); CopUi.focus = w; }
    copRerender();
  }));
  copWireOpenLinks(root);
}

/** "Open in ATLAS" links without a request ID (utility): say so instead of navigating. */
function copWireOpenLinks(root) {
  root.querySelectorAll("a.copx-open[data-noid]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    CopUi.msg = "Opens the request in ATLAS once the COP is built into ATLAS (the UDQ doesn't carry the request's ATLAS ID).";
    const m = document.getElementById("copMsg");
    if (m) m.textContent = CopUi.msg; else alert(CopUi.msg);
  }));
}

/** Daily-update forms (details panel) and the updates sheet. */
function copWireUpdates(root, byW) {
  const latestNote = (r) => { const u = copUpdatesFor(r)[0]; return u ? u.note : ""; };
  // Saving can take a moment inside ATLAS: lock the buttons, and on failure keep
  // the typed text and say why.
  const busy = (on) => root.querySelectorAll("[data-uadd],[data-uone],[data-usave]").forEach((b) => { b.disabled = on; });
  const fail = (e) => {
    console.error(e); busy(false);
    CopUi.msg = `Not saved — ${e.message || e}`;
    const m = root.querySelector(".copx-sheet-hd .copx-msg") || document.getElementById("copMsg");
    if (m) m.textContent = CopUi.msg; else alert(CopUi.msg);
  };
  const add = async (w, dateIso, ta, focusIdx) => {
    const r = byW[w]; const note = ta.value.trim();
    if (!r || !note) { ta.focus(); return; }
    busy(true);
    try { await copSaveDailyUpdate(w, dateIso, note, r); } catch (e) { return fail(e); }
    CopUi.msg = `Update saved for ${r.last5}.`;
    CopUi.focusUpd = focusIdx;
    copRerender();
  };
  root.querySelectorAll(".copx-uform").forEach((f) => {
    const w = f.dataset.w, ta = f.querySelector("[data-unote]"), dt = f.querySelector("[data-udate]");
    f.querySelector("[data-usame]").addEventListener("click", () => { ta.value = latestNote(byW[w]); ta.focus(); });
    f.querySelector("[data-uadd]").addEventListener("click", () => add(w, dt.value || xtIso(copToday()), ta, null));
    f.querySelector("[data-uhist]").addEventListener("click", () => copShowHistory(byW[w]));
  });
  const ud = root.querySelector("#copUpdDate");
  if (ud) ud.addEventListener("change", () => { CopUi.updDate = ud.value || ""; copRerender(); });
  // Sheet: each row has its own Save (ATLAS can time out on a long session, so
  // save as you go); "Save daily updates" saves every filled row at once.
  // Unsaved text is kept across re-renders so saving one row never loses the others.
  const iso = CopUi.updDate || xtIso(copToday());
  CopUi.sheetText = CopUi.sheetText || {};
  root.querySelectorAll(".copx-sheet tbody tr[data-w]").forEach((tr) => {
    const w = tr.dataset.w, ta = tr.querySelector("[data-unote]");
    const keep = () => { if (ta.value.trim()) CopUi.sheetText[w] = ta.value; else delete CopUi.sheetText[w]; };
    ta.addEventListener("input", keep);
    tr.querySelector("[data-usame]").addEventListener("click", () => { ta.value = latestNote(byW[w]); keep(); ta.focus(); });
    tr.querySelector("[data-uhist]").addEventListener("click", () => copShowHistory(byW[w]));
    tr.querySelector("[data-uone]").addEventListener("click", async () => {
      const note = ta.value.trim();
      if (!note || !byW[w]) { ta.focus(); return; }
      busy(true);
      try { await copSaveDailyUpdate(w, iso, note, byW[w]); } catch (e) { return fail(e); }
      delete CopUi.sheetText[w];
      CopUi.msg = `Saved ${byW[w].last5}'s update for ${copFmt(xtParseDate(iso))}.`;
      CopUi.focusUpd = Number(ta.dataset.i);            // the next row to update moves into this slot
      copRerender();
    });
  });
  // Save all = one save per filled row, in turn; rows that fail keep their text.
  root.querySelectorAll(".copx-sheet [data-usave]").forEach((b) => b.addEventListener("click", async () => {
    const filled = Array.from(root.querySelectorAll(".copx-sheet tbody tr[data-w]"))
      .map((tr) => ({ w: tr.dataset.w, note: tr.querySelector("[data-unote]").value.trim() }))
      .filter((x) => x.note && byW[x.w]);
    if (!filled.length) { CopUi.msg = "Nothing to save — type an update first."; copRerender(); return; }
    busy(true);
    let ok = 0; const bad = [];
    for (const x of filled) {
      try { await copSaveDailyUpdate(x.w, iso, x.note, byW[x.w]); delete CopUi.sheetText[x.w]; ok++; }
      catch (e) { console.error(e); CopUi.sheetText[x.w] = x.note; bad.push(`${byW[x.w].last5} (${String(e.message || e).replace(/\.$/, "")})`); }
    }
    CopUi.msg = (ok ? `Saved ${copPlural(ok, "daily update")} for ${copFmt(xtParseDate(iso))}. ` : "") +
      (bad.length ? `Not saved — ${bad.join("; ")}. Their text is still in the box.` : "");
    copRerender();
  }));
  if (CopUi.focusUpd != null) {
    const next = root.querySelector(`.copx-sheet textarea[data-i="${CopUi.focusUpd}"]`) || root.querySelector(".copx-sheet textarea");
    CopUi.focusUpd = null;
    if (next) requestAnimationFrame(() => next.focus());
  }
}

function copRerender() { if (AppState.activeTool === "cop") renderWorkspace(); }

function copWire(root, built, rows, isActive) {
  const $ = (s) => root.querySelector(s);
  const all = isActive ? built.active : built.closed;
  const byW = {};
  for (const r of all) byW[r.wmtr] = r;
  const setMsg = (t) => { CopUi.msg = t; const m = $("#copMsg"); if (m) m.textContent = t; };

  copWireTop(root);

  // filter panel
  const prefSet = (fn) => { const p = copGetPrefs(); fn(p); copSetPrefs(p); copRerender(); };
  $("#copPoc").addEventListener("change", (e) => { CopUi.poc = e.target.value; copRerender(); });
  if ($("#copHit")) $("#copHit").addEventListener("change", (e) => { CopUi.hit = e.target.value; copRerender(); });
  if ($("#copRisk")) $("#copRisk").addEventListener("change", (e) => { CopUi.atRisk = e.target.checked; copRerender(); });
  root.querySelectorAll(".copx-today button[data-quick]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.quick;
    if (k === "attention") { CopUi.atRisk = !CopUi.atRisk; CopUi.quick = ""; }
    else if (!k) { CopUi.quick = ""; CopUi.atRisk = false; }
    else { CopUi.quick = CopUi.quick === k ? "" : k; CopUi.atRisk = false; }
    copRerender();
  }));
  CopUi.q = "";
  $("#copReset").addEventListener("click", () => {
    Object.assign(CopUi, { poc: "", atRisk: false, rddDays: 0, q: "", hit: "", quick: "", focus: "" });
    const st = copTblState(isActive); st.f = {}; st.sort = "";
    copRerender();
  });
  if ($("#copLimits")) $("#copLimits").addEventListener("click", () => { CopUi.settingsOpen = !CopUi.settingsOpen; copRerender(); });
  root.querySelectorAll(".copx-limits input[type=number]").forEach((inp) => inp.addEventListener("change", () => {
    const p = copGetPrefs();
    const k = inp.dataset.k, i = Number(inp.dataset.i);
    const v = Math.max(1, Math.round(Number(inp.value) || 1));
    const pair = p.stuck[k].slice();
    pair[i] = v;
    if (pair[1] < pair[0]) pair[i === 0 ? 1 : 0] = v;
    p.stuck[k] = pair;
    copSetPrefs(p); copRerender();
  }));
  const so = $("#copStuckOn");
  if (so) so.addEventListener("change", () => { const p = copGetPrefs(); p.stuckOn = so.checked; copSetPrefs(p); copRerender(); });
  const rs = $("#copStuckReset");
  if (rs) rs.addEventListener("click", () => { const p = copGetPrefs(); p.stuck = Object.assign({}, COP_STUCK_DEFAULTS); copSetPrefs(p); copRerender(); });

  copWireOpenLinks(root);
  copWireUpdates(root, byW);
  copWireTable(root, isActive);
  const dcb = $("#copDocCheck");
  if (dcb) dcb.addEventListener("click", () => { CopUi.docCheck = !CopUi.docCheck; copRerender(); });
  const dcp = $("#copDcPeriod");
  if (dcp) dcp.addEventListener("change", () => { CopUi.dcPeriod = dcp.value; copRerender(); });
  ["#copDcFrom", "#copDcTo"].forEach((id) => { const i = $(id); if (i) i.addEventListener("change", () => { CopUi[id === "#copDcFrom" ? "dcFrom" : "dcTo"] = i.value; copRerender(); }); });
  const dcm = $("#copDcMissing");
  if (dcm) dcm.addEventListener("change", () => { CopUi.dcMissingOnly = dcm.checked; copRerender(); });
  root.querySelectorAll("button[data-hist]").forEach((b) => b.addEventListener("click", () => { if (byW[b.dataset.hist]) copShowHistory(byW[b.dataset.hist]); }));
  const um = $("#copUpdMode");
  if (um) um.addEventListener("click", () => { CopUi.updMode = !CopUi.updMode; CopUi.msg = ""; copRerender(); });

  $("#copExport").addEventListener("click", () => {
    try { copExportXlsx(rows, isActive); setMsg("Exported."); } catch (e) { console.error(e); setMsg("Export failed: " + e.message); }
  });
  $("#copPrint").addEventListener("click", () => copPrint(rows, isActive));

  // hover card (bubbles + table rows)
  const hover = copHoverEl();
  const showHover = (r, e) => { hover.innerHTML = copHoverHtml(r); hover.style.display = "block"; moveHover(e); };
  const moveHover = (e) => {
    const pad = 16, w = hover.offsetWidth, h = hover.offsetHeight;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > window.innerWidth - 8) x = Math.max(8, e.clientX - w - pad);
    if (y + h > window.innerHeight - 8) y = Math.max(8, e.clientY - h - pad);
    hover.style.left = x + "px"; hover.style.top = y + "px";
  };
  const hideHover = () => { hover.style.display = "none"; };
  const openRow = (w, scroll) => {
    CopUi.focus = w;
    CopUi.expanded.add(w);
    hideHover();
    copRerender();
    if (scroll) requestAnimationFrame(() => {
      const tr = document.querySelector(`.copx-tbl tr.row[data-w="${CSS.escape(w)}"]`);
      if (tr) tr.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };
  root.querySelectorAll(".copx-bub").forEach((b) => {
    const r = byW[b.dataset.w];
    if (!r) return;
    b.addEventListener("mouseenter", (e) => showHover(r, e));
    b.addEventListener("mousemove", moveHover);
    b.addEventListener("mouseleave", hideHover);
    b.addEventListener("focus", () => { const rc = b.getBoundingClientRect(); showHover(r, { clientX: rc.right, clientY: rc.top }); });
    b.addEventListener("blur", hideHover);
    b.addEventListener("click", () => openRow(r.wmtr, true));
  });
  root.querySelectorAll(".copx-tbl tr.row").forEach((tr) => {
    const r = byW[tr.dataset.w];
    if (!r) return;
    if (isActive) {
      tr.addEventListener("mouseenter", (e) => showHover(r, e));
      tr.addEventListener("mousemove", moveHover);
      tr.addEventListener("mouseleave", hideHover);
    }
    tr.addEventListener("click", (e) => {
      if (e.target.closest("a,button")) return;
      if (CopUi.expanded.has(r.wmtr)) { CopUi.expanded.delete(r.wmtr); if (CopUi.focus === r.wmtr) CopUi.focus = ""; hideHover(); copRerender(); }
      else openRow(r.wmtr, false);
    });
  });
  root.querySelectorAll("button[data-ack]").forEach((b) => b.addEventListener("click", () => {
    if (typeof xtAddIgnore === "function") xtAddIgnore(b.dataset.req, b.dataset.ack);
    copRerender();
  }));
  root.querySelectorAll("button[data-unack]").forEach((b) => b.addEventListener("click", () => {
    if (typeof xtRemoveIgnore !== "function") return;
    const ig = xtGetIgnores()[b.dataset.req] || [];
    if (ig.indexOf(b.dataset.unack) !== -1) xtRemoveIgnore(b.dataset.req, b.dataset.unack);
    else alert("This item is covered by a broader acknowledgement made in the Christmas Tree (e.g. all metrics, or all shipping documents). Undo it there, in the Ignored list.");
    copRerender();
  }));
}

/* -------------------------------------------------------------------------
   OUTPUTS — Excel export and a print snapshot of the current view
   ------------------------------------------------------------------------- */
/* =========================================================================
   DOC CHECK (2.6.18) — Closed tab, for management: which required shipping
   documents each closed request has, and how many of each were prepared in a
   fiscal period. Same required set as the shipping-documents metric (reqatt
   _raRequiredAbbrs / _raEvaluate). One of each type per request, however many
   files were uploaded. Period = Delivery Date (Date Completed if blank).
   ========================================================================= */
const COP_DC_COLS = [
  { key: "AWB", label: "AWB/BoL", types: ["Carrier waybills", "Bills of Lading"] },
  { key: "CIV", label: "CIV", types: ["Commercial/Proforma Invoices"] },
  { key: "AES", label: "AES/MFR", types: ["Automated Export System (AES) records", "MFR_NO AES"] },
  { key: "MCT", label: "MCT", types: ["MCT"] },
  { key: "SLI", label: "SLI", types: ["Shippers Letter of Instructions"] },
  { key: "VAT", label: "VAT", types: ["VAT Exemption"] },
  { key: "POD", label: "POD", types: ["Proof of Delivery"] },
  { key: "PKL", label: "PKL/IPC", types: ["Packing List", "IPC"] },
];
const COP_DC_PERIODS = [
  ["q", "Current quarter"], ["h", "Current half"], ["fy", "Current FY"],
  ["pq", "Previous quarter"], ["ph", "Previous half"], ["pfy", "Previous FY"],
  ["all", "All closed"], ["custom", "Custom dates"],
];
/** Fiscal periods (FY starts 1 Oct; Q1 Oct–Dec, H1 Oct–Mar). */
function copFyPeriod(kind) {
  const t = copToday();
  const fy = t.getMonth() >= 9 ? t.getFullYear() + 1 : t.getFullYear();
  const fm = (t.getMonth() + 3) % 12;                       // fiscal month: Oct = 0
  const at = (y, m) => new Date(m >= 3 ? y : y - 1, (m + 9) % 12, 1);   // fiscal month m of FY y
  const span = (y, m, len) => {
    const start = at(y, m);
    const end = m + len >= 12 ? at(y + 1, m + len - 12) : at(y, m + len);
    end.setDate(end.getDate() - 1);
    return { start, end };
  };
  const yy = (y) => "FY" + String(y).slice(-2);
  const q = Math.floor(fm / 3), h = Math.floor(fm / 6);
  switch (kind) {
    case "q":  return Object.assign(span(fy, q * 3, 3), { label: `${yy(fy)} Q${q + 1}` });
    case "pq": return q ? Object.assign(span(fy, (q - 1) * 3, 3), { label: `${yy(fy)} Q${q}` })
                        : Object.assign(span(fy - 1, 9, 3), { label: `${yy(fy - 1)} Q4` });
    case "h":  return Object.assign(span(fy, h * 6, 6), { label: `${yy(fy)} ${h ? "second" : "first"} half` });
    case "ph": return h ? Object.assign(span(fy, 0, 6), { label: `${yy(fy)} first half` })
                        : Object.assign(span(fy - 1, 6, 6), { label: `${yy(fy - 1)} second half` });
    case "fy": return Object.assign(span(fy, 0, 12), { label: yy(fy) });
    case "pfy": return Object.assign(span(fy - 1, 0, 12), { label: yy(fy - 1) });
    case "custom": {
      const s = xtParseDate(CopUi.dcFrom), e = xtParseDate(CopUi.dcTo);
      return { start: s, end: e, label: s || e ? `${s ? copFmt(s) : "…"} – ${e ? copFmt(e) : "…"}` : "Custom dates" };
    }
    default: return { start: null, end: null, label: "All closed" };
  }
}
/** One row per closed request: X / Missing / N/A per document column. */
function copDocRow(r) {
  const rec = r.rec, sc = copShipClass(rec);
  const types = rec.att.map((a) => a.type);
  const when = r.delivered || xtParseDate(rec.f["date completed"]) || null;
  const kind = sc.handCarry ? "Hand carry" : sc.courier ? "Courier" : ({ EXPORT: "US export", IMPORT: "US import", F2F: "Foreign to foreign", DOMESTIC: "Domestic" })[sc.category] || "Unknown route";
  const missing = new Set();
  if (!sc.handCarry && sc.category !== "UNKNOWN") {
    const ev = _raEvaluate(sc.category, types, sc.origin, sc.courier);
    for (const x of ev.required) if (!x.satisfied) missing.add(x.abbr);
  }
  const cells = {};
  for (const c of COP_DC_COLS) {
    const has = copHasType(types, c.types);
    cells[c.key] = missing.has(c.key) ? "miss" : has ? "x" : (sc.category === "UNKNOWN" && !sc.handCarry ? "unk" : "na");
  }
  return { r, when, kind, cells, nMissing: missing.size };
}
function copDocCheckRows(base) {
  const p = copFyPeriod(CopUi.dcPeriod || "h");
  let rows = base.map(copDocRow);
  if (p.start || p.end) rows = rows.filter((d) => d.when && (!p.start || d.when >= p.start) && (!p.end || d.when <= p.end));
  return { p, rows };
}
function copDocCheck(base) {
  const { p, rows } = copDocCheckRows(base);
  const shown = CopUi.dcMissingOnly ? rows.filter((d) => d.nMissing) : rows;
  CopUi._dcRows = rows;
  const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(t)}</option>`;
  const per = CopUi.dcPeriod || "h";
  const count = (k, v) => rows.filter((d) => d.cells[k] === v).length;
  const withMissing = rows.filter((d) => d.nMissing).length;
  const range = p.start || p.end ? ` (${p.start ? copFmt(p.start) : "…"} – ${p.end ? copFmt(p.end) : "…"})` : "";
  const wrap = el(`<div class="copx-dc">
    <div class="copx-dc-hd">
      <div class="copx-f"><label for="copDcPeriod">Delivered in</label><select id="copDcPeriod">${COP_DC_PERIODS.map(([v, t]) => opt(v, t, v === per)).join("")}</select></div>
      ${per === "custom" ? `<div class="copx-f"><label for="copDcFrom">From</label><input type="date" id="copDcFrom" value="${esc(CopUi.dcFrom || "")}"></div>
        <div class="copx-f"><label for="copDcTo">To</label><input type="date" id="copDcTo" value="${esc(CopUi.dcTo || "")}"></div>` : ""}
      <label class="copx-chk"><input type="checkbox" id="copDcMissing" ${CopUi.dcMissingOnly ? "checked" : ""}> Only requests with missing documents</label>
      <span class="copx-dc-sumline"><b>${rows.length}</b> closed request${rows.length === 1 ? "" : "s"} · ${esc(p.label)}${esc(range)} · <span class="${withMissing ? "copx-red" : ""}"><b>${withMissing}</b> with missing documents</span></span>
    </div>
    <div class="copx-dc-cards">${COP_DC_COLS.map((c) => { const x = count(c.key, "x"), m = count(c.key, "miss");
      return `<div class="copx-dc-card"><div class="k">${esc(c.label)}</div><div class="n">${x}</div><div class="s">prepared${m ? ` · <span class="copx-red">${m} missing</span>` : ""}</div></div>`; }).join("")}</div>
    <div class="copx-tbl"><table class="copx-dc-t"><thead><tr><th>WMTR #</th><th>Delivered</th><th>Route</th>${COP_DC_COLS.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody></tbody></table></div>
    <div class="copx-dc-legend"><b>X</b> attached · <span class="copx-red"><b>Missing</b></span> required but not attached · N/A not required for this route · counted once per request</div>
  </div>`);
  const tb = wrap.querySelector("tbody");
  const word = { x: "X", miss: "Missing", na: "N/A", unk: "—" };
  for (const d of shown.slice().sort((a, b) => b.r.num - a.r.num)) {
    tb.appendChild(el(`<tr><td class="w">${copWmtrLink(d.r, d.r.wmtr)}</td><td class="nw">${d.when ? esc(copFmt(d.when)) : "—"}</td><td class="nw">${esc(d.kind)}</td>
      ${COP_DC_COLS.map((c) => `<td class="dc ${d.cells[c.key]}">${word[d.cells[c.key]]}</td>`).join("")}</tr>`));
  }
  if (!shown.length) tb.appendChild(el(`<tr><td colspan="${3 + COP_DC_COLS.length}" class="copx-msg">No closed requests ${CopUi.dcMissingOnly ? "with missing documents " : ""}in this period.</td></tr>`));
  return wrap;
}
function copExportDocCheck(rows) {
  const word = { x: "X", miss: "Missing", na: "N/A", unk: "" };
  const head = ["WMTR #", "Delivered", "Route", "TTI POC"].concat(COP_DC_COLS.map((c) => c.label));
  const aoa = [head];
  for (const d of rows.slice().sort((a, b) => b.r.num - a.r.num))
    aoa.push([d.r.wmtr, d.when ? copFmt(d.when) : "", d.kind, d.r.poc].concat(COP_DC_COLS.map((c) => word[d.cells[c.key]])));
  const sum = [["Document", "Prepared", "Missing"]].concat(COP_DC_COLS.map((c) => [c.label,
    rows.filter((d) => d.cells[c.key] === "x").length, rows.filter((d) => d.cells[c.key] === "miss").length]));
  sum.push([], ["Period", copFyPeriod(CopUi.dcPeriod || "h").label], ["Closed requests", rows.length]);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = head.map((h, i) => ({ wch: i === 0 ? 28 : i < 4 ? 18 : 10 }));
  XLSX.utils.book_append_sheet(wb, ws, "Doc Check");
  const ws2 = XLSX.utils.aoa_to_sheet(sum);
  ws2["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Summary");
  pmrDownloadXlsxB64(XLSX.write(wb, { type: "base64", bookType: "xlsx" }), `COP_DocCheck_${fileStamp()}.xlsx`);
}

function copExportXlsx(rows, isActive) {
  if (!isActive && CopUi.docCheck && CopUi._dcRows) return copExportDocCheck(CopUi._dcRows);
  const top = isActive
    ? [["WMTR", "TTI POC", "Step", "ATLAS Status", "Missed", "Attention", "Daily updates missed", "Latest update date", "Latest update",
        "RDD", "Days in step", "Origin", "Destination", "Mode", "Program", "Title", "Carrier", "AWB/BoL"]]
    : [["WMTR", "TTI POC", "ATLAS Status", "Missed", "Attention", "Delivered", "Origin", "Destination", "Program", "Title"]];
  const det = [["WMTR", "TTI POC", "Status", "Group", "Check", "Result", "Detail"]];
  for (const r of rows) {
    if (isActive) top.push([r.wmtr, r.poc, r.step ? COP_STEPS[COP_STEP_IDX[r.step]].label : "", r.status, r.counts.red, r.counts.amber,
      r.daily.missed.length, r.latest ? copFmt(r.latest.date) : "", r.latest ? r.latest.note : "", copFmt(r.rdd), r.daysInStep ?? "",
      r.origin, r.dest, r.mode, r.program, r.title, r.carrier, r.awb]);
    else top.push([r.wmtr, r.poc, r.status, r.counts.red, r.counts.amber, copFmt(r.delivered), r.origin, r.dest, r.program, r.title]);
    for (const c of r.checks) {
      const g = COP_GROUPS.find((x) => x.stages.indexOf(c.stage) !== -1);
      det.push([r.wmtr, r.poc, r.status, g ? g.label : c.stage, c.label, copStateMeta(c.state).word, c.detail]);
    }
  }
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(top);
  ws1["!cols"] = top[0].map((h) => ({ wch: /update$|Title/.test(h) ? 50 : /WMTR/.test(h) ? 26 : 16 }));
  const ws2 = XLSX.utils.aoa_to_sheet(det);
  ws2["!cols"] = [{ wch: 26 }, { wch: 18 }, { wch: 22 }, { wch: 30 }, { wch: 44 }, { wch: 13 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, ws1, isActive ? "Active" : "Closed");
  XLSX.utils.book_append_sheet(wb, ws2, "Checklist");
  pmrDownloadXlsxB64(XLSX.write(wb, { type: "base64", bookType: "xlsx" }), `COP_${isActive ? "Active" : "Closed"}_${fileStamp()}.xlsx`);
}
function copPrint(rows, isActive) {
  const by = (id) => rows.filter((r) => r.step === id);
  const cols = isActive ? COP_STEPS.map((s) => {
    const xs = by(s.id), red = xs.filter((r) => r.health === "red").length, amb = xs.filter((r) => r.health === "amber").length;
    return `<td><div class="l">${s.n} · ${esc(s.label)}</div><div class="n">${xs.length}</div><div><span class="r">${red} missed</span> · <span class="a">${amb} attention</span></div></td>`;
  }).join("") : "";
  const trs = rows.slice().sort((a, b) => (b.stepIdx || 0) - (a.stepIdx || 0) || a.num - b.num).map((r) => {
    const fails = r.checks.filter((c) => c.state === "fail").map((c) => esc(c.label)).join("; ");
    const warns = r.checks.filter((c) => c.state === "warn" || c.state === "due").map((c) => esc(c.label)).join("; ");
    return `<tr><td class="m">${esc(r.last5)}</td><td>${esc(r.poc)}</td><td>${esc(r.status)}</td>
      <td>${r.latest ? `<small>${esc(copFmt(r.latest.date))}</small> ${esc(r.latest.note)}` : ""}</td><td class="r">${fails}</td><td class="a">${warns}</td></tr>`;
  }).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>ATLAS COP ${esc(copFmt(copToday()))}</title><style>
    @page{size:landscape;margin:10mm}body{font-family:Poppins,Arial,sans-serif;font-size:10px;color:#1f2d3d;margin:0}
    h1{font-size:15px;margin:0 0 2px}.sub{color:#5a6778;margin-bottom:8px}
    table.s{border-collapse:collapse;width:100%;margin-bottom:10px}table.s td{border:1px solid #d6dde8;padding:5px;vertical-align:top}
    .l{font-weight:600}.n{font-size:18px;font-weight:700}.r{color:#c62828}.a{color:#c65d00}
    table.t{border-collapse:collapse;width:100%}table.t th,table.t td{border:1px solid #d6dde8;padding:3px 5px;vertical-align:top;text-align:left}
    table.t th{background:#6d9ad0;color:#fff}.m{font-weight:700;white-space:nowrap}small{color:#5a6778}
  </style></head><body><h1>ATLAS COP — ${isActive ? "Shipments In Progress" : "Closed Shipments"}</h1>
  <div class="sub">${esc(copFmt(copToday()))} · ${rows.length} shown</div>
  ${cols ? `<table class="s"><tr>${cols}</tr></table>` : ""}
  <table class="t"><thead><tr><th>WMTR</th><th>TTI POC</th><th>Status</th><th>Latest daily update</th><th>Missed</th><th>Attention</th></tr></thead><tbody>${trs}</tbody></table>
  <script>window.onload=function(){setTimeout(function(){window.print();},200);};<\/script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Your browser blocked the print window. Allow pop-ups for this site and try again."); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

/* -------------------------------------------------------------------------
   HUB — the COP is the one rail button for every management view; Pipeline,
   Metrics (the Metrics dashboard), PMR, Export-Controlled and the Christmas
   Tree are tabs inside it. Tab ids are the TOOLS ids (app.js, hub: true).
   ------------------------------------------------------------------------- */
const COP_HUB_TOOLS = ["cop", "proc", "prop", "pls", "pmr", "ecm", "xmastree"];     // workspace tools ("metrics" = the dashboard)
function copIsHubTool(id) { return COP_HUB_TOOLS.indexOf(id) !== -1; }
/** True while any COP tab is on screen (the Metrics tab = no tool on a Metrics UDQ). */
function copHubActive() {
  return copIsHubTool(AppState.activeTool) || (!AppState.activeTool && AppState.udqType === "metrics");
}
function copHubSelect(id) {
  if (id === "metrics") { AppState.activeTool = null; AppState.dashCollapsed = false; }
  else { AppState.activeTool = id; AppState.dashCollapsed = true; }
  renderRail(); renderDashboard(); renderWorkspace();
  // Procurement / Property tabs pull the PR + PMCT UDQs as soon as they open (pmdash.js).
  if (typeof pmIsTool === "function" && pmIsTool(id)) pmAutoPull();
  requestAnimationFrame(() => {
    const nav = document.querySelector(".cop-hub");
    if (nav) nav.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
function copRailButton() {
  const btn = el(`
    <button class="rail-cop ${copHubActive() ? "active" : ""}" type="button" title="Dashboard — shipments, procurement, property, PLS and metrics">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="10" rx="1"/><rect x="17" y="4" width="4" height="6" rx="1"/>
      </svg>
      <span><span class="t">Dashboard</span></span>
    </button>`);
  // Every UDQ the Dashboard uses starts pulling at once: Metrics (copAutoFetch) + PR, PMCT, PLS (pmAutoPull).
  btn.addEventListener("click", () => {
    copHubSelect("cop"); copAutoFetch();
    if (typeof pmAutoPull === "function") pmAutoPull();
  });
  return btn;
}

/* Clicking Dashboard pulls the latest UDQ from ATLAS. Nothing is shown until
   that pull has finished (2.9.0): the first open is a "Getting the latest…"
   card, never a saved copy of an older pull — that looked like fresh data.
   Once data is on screen the header always says when it was pulled; a later
   pull keeps it up, marked "Refreshing…", and swaps the new data in. Then the
   Christmas Tree SRF slot reuses the same pull. Fetch only works when the
   Utility runs inside ATLAS; elsewhere it says so and waits for a dropped
   UDQ. A full pull within the last COP_AUTO_PULL_MIN minutes isn't repeated
   (the Refresh button forces one); once ATLAS can send only what changed
   (atlasChangesOn), every click pulls. */
const COP_AUTO_PULL_MIN = 10;
const CopPull = { busy: false, at: 0, okAt: 0, err: "" };
function copClock(ms) {
  return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
/* Load Metrics records without losing your place: on a refresh the tab you're
   on (Metrics included) and the Metrics reporting window stay as they were. */
async function copSwapInMetrics(recs, label) {
  const keep = AppState.activeTool;
  const prev = AppState.udqType === "metrics" && typeof MetricsUi !== "undefined"
    ? { tool: AppState.activeTool, collapsed: AppState.dashCollapsed,
        mx: { start: MetricsUi.start, end: MetricsUi.end, label: MetricsUi.label, quick: MetricsUi.quick, sel: MetricsUi.sel } } : null;
  await atlasLoadMetricsRecords(recs, label);
  if (prev) {
    AppState.activeTool = prev.tool; AppState.dashCollapsed = prev.collapsed;
    Object.assign(MetricsUi, prev.mx);
  } else if (keep && keep !== AppState.activeTool && copIsHubTool(keep)) {
    AppState.activeTool = keep;
  } else return;
  renderRail(); renderDashboard(); renderWorkspace();
}
async function copAutoFetch(force) {
  if (CopPull.busy || typeof atlasPullMetricsRecords !== "function") return;
  const minGap = atlasChangesOn() ? 0 : COP_AUTO_PULL_MIN;
  if (!force && AppState.udqType === "metrics" && Date.now() - CopPull.at < minGap * 60000) return;
  CopPull.busy = true;
  CopPull.at = Date.now();
  CopPull.err = "";
  copRerender();                                     // "Getting the latest…" / "Refreshing…"
  let recs;
  try {
    recs = await atlasPullMetricsRecords();
  } catch (e) {
    console.error(e);
    CopPull.err = String(e.message || e);
    if (AppState.udqType === "metrics" && /^ATLAS API/i.test(AppState.fileName || ""))
      atlasSetStatus(`Couldn't refresh from ATLAS — ${CopPull.err} Still showing the earlier pull.`, true);
    else atlasSetStatus("");
    CopPull.busy = false;
    copRerender();
    copHubRefreshTabs();                             // not connected → the drop box appears
    return;                                          // no ATLAS → don't try the Christmas Tree either
  }
  // Swap in only if the Metrics data (or nothing) is still what's loaded —
  // never replace a shipment opened while the pull ran.
  CopPull.busy = false;
  if (AppState.udqType === "metrics" || !AppState.grid) {
    CopPull.okAt = Date.now();
    await copSwapInMetrics(recs);
    atlasSetStatus(`Up to date with ATLAS as of ${copClock(CopPull.okAt)} — ${recs.length} records.`);
    copRerender();
    copHubRefreshTabs();
  }
  // Christmas Tree SRF slot from the pull above (no extra fetch). PR / PMCT / PLS are pulled by pmAutoPull
  // when Dashboard is clicked; the WS UDQ isn't pulled while the Christmas Tree tab is hidden.
  if (typeof loadFromAtlasXmasTree === "function") {
    try { await loadFromAtlasXmasTree({ quiet: true, services: ["SRF"], srfRecords: recs }); } catch (e) { console.error(e); }
  }
}
function copHubTabs() {
  const hasMetrics = AppState.udqType === "metrics";
  const cur = AppState.activeTool || (hasMetrics ? "metrics" : "");
  const all = (typeof TOOLS !== "undefined" ? TOOLS : []).filter((t) => t.hub && !t.hubHidden);
  // PMR / Export-Controlled (hubUnder: "metrics") sit in a sub-tab row under Metrics and light it up.
  const curTool = all.find((t) => t.id === cur);
  const group = curTool && curTool.hubUnder ? curTool.hubUnder : cur;
  // With the Dashboard drop box on, Procurement / Property / PLS light up only once their UDQ is loaded.
  const drop = copHubDropOn();
  const btn = (t, on, label) => {
    const metricsOk = t.needs !== "metrics" || hasMetrics;
    const dataOk = !drop || t.id === cur || copHubHas(t.id);
    const ok = metricsOk && dataOk;
    const why = !metricsOk ? "Load or fetch a Metrics UDQ first"
      : typeof PmPull !== "undefined" && PmPull.busy ? "Pulling from ATLAS…"
      : `Drop the ${COP_HUB_UDQ[t.id]} UDQ in the box below first`;
    const b = el(`<button type="button" class="${on ? "active" : ""}" ${ok ? "" : "disabled"}
      ${on ? 'aria-current="page"' : ""} title="${ok ? esc(t.label) : esc(why)}">${esc(label || t.label)}</button>`);
    if (ok) b.addEventListener("click", () => { if (cur !== t.id) copHubSelect(t.id); });
    return b;
  };
  const wrap = el(`<div class="cop-hub-wrap cop-hub-top"></div>`);
  const nav = el(`<nav class="cop-hub" aria-label="COP views"></nav>`);
  for (const t of all.filter((x) => !x.hubUnder)) nav.appendChild(btn(t, group === t.id));
  wrap.appendChild(nav);
  const subs = all.filter((t) => t.hubUnder === group);
  if (subs.length) {
    const parent = all.find((t) => t.id === group);
    const sub = el(`<nav class="cop-hub sub" aria-label="${esc(parent ? parent.label : "")} views"></nav>`);
    if (parent) sub.appendChild(btn(parent, cur === parent.id, "Overview"));
    for (const t of subs) sub.appendChild(btn(t, cur === t.id));
    wrap.appendChild(sub);
  }
  if (copHubDropShown()) wrap.appendChild(copHubDropBox());
  return wrap;
}

/* -------------------------------------------------------------------------
   DASHBOARD DROP BOX — one drop target under the tab bar on every Dashboard tab.
   Drop any UDQ export(s), one or several at once: Metrics → Shipments / Metrics /
   PMR / Export-Controlled, PR → Procurement, PMCT → Property, PLS → PLS (a WS UDQ
   goes to the Christmas Tree). Anything else (a single-shipment UDQ…)
   goes to the main loader, exactly as the main drop zone would take it.
   Only for working WITHOUT ATLAS (2.9.2): it shows when a pull from ATLAS hasn't
   worked (atlas-utility.net), never once one has (copAtlasConnected — every tab is
   then always clickable), and not while a pull is still running. Settings ›
   General › "Dashboard UDQ drop box" switches it off altogether.
   ------------------------------------------------------------------------- */
const COP_HUB_UDQ = { cop: "Metrics", metrics: "Metrics", pmr: "Metrics", ecm: "Metrics", proc: "PR", prop: "PMCT", pls: "PLS" };
const CopDrop = { status: "", err: false, busy: false };
/** A pull from ATLAS has worked this session = the Utility is running connected to ATLAS. */
function copAtlasConnected() { return typeof AtlasLive !== "undefined" && !!AtlasLive.ok; }
/** The drop box (and "a tab lights up once its UDQ is dropped") is only for working
    WITHOUT ATLAS — e.g. on atlas-utility.net. Once a pull has worked it's off;
    Settings › General can also switch it off altogether. */
function copHubDropOn() {
  if (copAtlasConnected()) return false;
  try { return typeof AtlasSettings === "undefined" || AtlasSettings.get().dashDrop !== false; } catch (e) { return true; }
}
/** Out of sight while a pull is still running, so it never flashes up inside ATLAS. */
function copHubDropShown() {
  return copHubDropOn() && !CopPull.busy && !(typeof PmPull !== "undefined" && PmPull.busy);
}
/** Does this tab's UDQ have data loaded? (Shipments and the Metrics tabs follow the Metrics UDQ.) */
function copHubHas(id) {
  const u = COP_HUB_UDQ[id];
  if (u === "PR" || u === "PMCT") return !!(typeof XTree !== "undefined" && XTree.slots[u]);
  if (u === "PLS") return !!(typeof PmPls !== "undefined" && PmPls.slot);
  if (id === "cop") return true;                       // Shipments explains itself when nothing's loaded
  return AppState.udqType === "metrics";
}
/** Redraw just the tab bar + drop box (after a background pull or a drop), wherever it's showing. */
function copHubRefreshTabs() {
  document.querySelectorAll(".cop-hub-top").forEach((n) => n.replaceWith(copHubTabs()));
}
function copHubDropBox() {
  const chip = (u, on) => `<span class="cop-drop-chip ${on ? "on" : ""}">${on ? "&#10003; " : ""}${esc(u)}</span>`;
  const has = { Metrics: AppState.udqType === "metrics", PR: copHubHas("proc"), PMCT: copHubHas("prop"), PLS: copHubHas("pls") };
  const box = el(`<div class="cop-drop">
    <div class="dropzone compact" tabindex="0" role="button" aria-label="Drop UDQ exports for the Dashboard"
      title="Metrics, PR, PMCT and PLS UDQ exports (.xlsx) — one or several at once, or click to browse. Each lights up its own tab.">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;color:var(--steel)">
        <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>
      <div style="flex:1;min-width:0"><div class="dz-title">${CopDrop.busy ? "Reading…" : "Drop UDQs here"}</div></div>
      <div class="cop-drop-chips" aria-label="Loaded UDQs">${Object.keys(has).map((u) => chip(u, has[u])).join("")}</div>
    </div>
    <input type="file" accept=".xlsx,.xlsm,.xls" multiple hidden>
    <div class="cop-drop-status ${CopDrop.err ? "err" : ""}" role="status">${esc(CopDrop.status)}</div>
  </div>`);
  const dz = box.querySelector(".dropzone"), input = box.querySelector("input");
  const take = (files) => { if (files && files.length && !CopDrop.busy) copHubIngest(files); };
  dz.addEventListener("click", () => input.click());
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => { take(Array.from(input.files || [])); input.value = ""; });
  for (const ev of ["dragover", "dragenter"]) dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); });
  for (const ev of ["dragleave", "drop"]) dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); });
  dz.addEventListener("drop", (e) => take(e.dataTransfer && e.dataTransfer.files));
  return box;
}
async function copHubIngest(fileList) {
  const list = Array.from(fileList || []).filter((f) => /\.xls[xm]?$/i.test(f.name));
  if (!list.length) { CopDrop.status = "Those aren't UDQ exports — drop the .xlsx files from ATLAS."; CopDrop.err = true; copHubRefreshTabs(); return; }
  const prevTab = AppState.activeTool || (AppState.udqType === "metrics" ? "metrics" : "cop");
  CopDrop.busy = true; CopDrop.status = ""; CopDrop.err = false;
  copHubRefreshTabs();
  const svcFiles = [], mains = [];
  for (const f of list) {
    let grid = null;
    try { grid = workbookToGrid(await f.arrayBuffer()); } catch (e) { mains.push({ f, t: "" }); continue; }
    const svc = typeof pmIsPlsGrid === "function" && pmIsPlsGrid(grid) ? "PLS"
      : typeof xtClassifyService === "function" ? xtClassifyService(grid) : null;
    if (svc && svc !== "SRF") svcFiles.push({ f, svc });        // a Metrics UDQ reads as SRF — it goes to the main loader
    else mains.push({ f, t: detectUdqType(grid) });
  }
  mains.sort((a, b) => (a.t === "metrics") - (b.t === "metrics"));   // a Metrics UDQ loads last, so it's the one left loaded
  for (const m of mains) await loadFile(m.f);
  if (svcFiles.length && typeof pmIngest === "function") await pmIngest(svcFiles.map((x) => x.f));

  // What landed where.
  const got = new Set(), parts = [], bad = [], other = [];
  for (const m of mains) {
    if (m.t === "metrics") {
      if (AppState.udqType === "metrics" && AppState.fileName === m.f.name) { got.add("Metrics"); parts.push("Metrics → Shipments, Metrics, PMR, Export-Controlled"); }
      else bad.push(m.f.name);
    } else other.push(m.f.name);
  }
  const tabName = { PR: "Procurement", PMCT: "Property", PLS: "PLS", WS: "Christmas Tree" };
  for (const { f, svc } of svcFiles) {
    const slot = svc === "PLS" ? PmPls.slot : XTree.slots[svc];
    if (!slot || slot.fileName !== f.name) { bad.push(f.name); continue; }
    const n = svc === "PLS" ? pmBlocks(slot.grid, /^PLS-/i).length : slot.records.length;
    got.add(svc); parts.push(`${svc} → ${tabName[svc]} (${n})`);
  }
  CopDrop.busy = false;
  const errMsg = bad.length ? ` Couldn't load ${bad.join(", ")}` +
    (XTree.statusErr && XTree.status ? ` — ${XTree.status}` : PmPls.err && PmPls.status ? ` — ${PmPls.status}` : ".") : "";
  CopDrop.status = errMsg.trim() +
    (other.length && !copHubActive() ? "" : other.length ? ` ${other.join(", ")} isn't a Dashboard UDQ — it went to the main loader.` : "");
  CopDrop.err = !!bad.length && !parts.length;
  if (!copHubActive()) return;                         // a shipment UDQ was opened instead — loadFile already showed it

  // Open the right tab: stay where you are if this drop fed it; otherwise the first tab that just got data.
  const order = ["cop", "proc", "prop", "pls"];
  const target = got.has(COP_HUB_UDQ[prevTab]) ? prevTab : order.find((id) => got.has(COP_HUB_UDQ[id])) || prevTab;
  copHubSelect(target);
}


/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { copParseGrid, copEvaluate, copActiveEvaluate, copStepInfo, copTimeline, copTrackerRows, copDailyGaps, copParseRelief, COP_STEPS };
}
