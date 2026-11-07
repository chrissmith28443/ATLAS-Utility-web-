/* =========================================================================
   ATLAS Utility Web — tools/pmdash.js
   Procurement (PR) and Property (PMCT / TOP) dashboards + the DPM's weekly
   quad slide (PowerPoint export).

   WHERE IT LIVES
     Two tabs in the Dashboard (COP hub): "Procurement" and "Property (TOP)".
     Tab ids "proc" / "prop" are TOOLS ids (app.js, hub: true).

   DATA
     The same PR and PMCT UDQs the Christmas Tree uses (XTree.slots.PR / .PMCT,
     each with its raw grid). Opening either tab pulls both from ATLAS in the
     background (pmAutoPull -> loadFromAtlasXmasTree({ services: ["PR","PMCT"] })).
     Outside ATLAS, drop the two UDQ exports on the tab instead.

   ACTIVE vs CLOSED
     Closed = Completed, Ready To Invoice, Invoiced, Cancelled (any form) —
     same rule as the COP. Everything else is active; Drafts are hidden unless
     "Show drafts" is ticked.

   WEEKLY SLIDE
     One 16:9 quad slide (Procurement, Property, Personnel Logistics Services,
     Significant Program Actions). Procurement + Property fill from the data;
     every quadrant also has a notes box (saved per browser, atlas.pmdash.slide,
     included in Backup). Export = real .pptx via pptxgenjs, loaded only when
     the button is clicked (js/vendor copy first, then the jsDelivr CDN).
   ========================================================================= */

/* ---- tunables ---- */
const PM_SOON_DAYS = 7;            // "due within 7 days" (estimates, POs)
const PM_RDD_SOON_DAYS = 14;       // RDD coming up (amber)
const PM_STALE_DAYS = 14;          // no Activity Tracker update for this long (amber)
const PM_BIG_TOP = 200000;         // high-value TOP (Jon's $200K line)
const PM_BIG_PR = 100000;          // CT Program > $100K
const PM_AUTO_PULL_MIN = 10;       // don't re-pull within this many minutes
const PM_SLIDE_KEY = "atlas.pmdash.slide";
const PM_PPTX_SRC = ["js/vendor/pptxgen.min.js", "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.min.js"];

const PM_TOOLS = ["proc", "prop"];
function pmIsTool(id) { return PM_TOOLS.indexOf(id) !== -1; }

/* Lanes (pipeline steps). Colours = one blue ramp (ordinal), drafts neutral. */
const PM_PR_LANES = [
  { id: "draft",    label: "Draft",                 color: "#aab4c3" },
  { id: "review",   label: "TTI / DTRA review",     color: "#5598e7" },
  { id: "estimate", label: "Estimate / Approval",   color: "#2a78d6" },
  { id: "sourcing", label: "Sourcing (PO pending)", color: "#184f95" },
  { id: "exec",     label: "PO issued / delivery",  color: "#1e2a4a" },
];
const PM_TOP_LANES = [
  { id: "draft",     label: "Draft",                     color: "#aab4c3" },
  { id: "review",    label: "In review",                 color: "#5598e7" },
  { id: "approved",  label: "Approved, not delivered",   color: "#2a78d6" },
  { id: "delivered", label: "Delivered, TOP open",       color: "#1e2a4a" },
];
/* TOP backlog buckets — days since delivery (Jon's slide). */
const PM_AGE = [
  { id: "pre", label: "Not yet delivered", color: "#8c97a8" },
  { id: "a15", label: "Within 15 days",    color: "#3987e5" },
  { id: "a30", label: "16–30 days",        color: "#1c5cab" },
  { id: "a31", label: "Over 30 days",      color: "#c62828" },
  { id: "unk", label: "Delivered – date unknown", color: "#d08a00" },   // Delivered status but no delivery date anywhere
];
const PM_AGE_UNK = PM_AGE[PM_AGE.length - 1];
/** Age buckets worth showing for these rows ("date unknown" only when something is in it). */
function pmAgesFor(rows) { return PM_AGE.filter((a) => a.id !== "unk" || rows.some((r) => r.bucket === "unk")); }

function pmPrLane(status) {
  const s = norm(status).toLowerCase();
  if (/^draft/.test(s)) return "draft";
  if (/production|delivery|shipped|received/.test(s)) return "exec";
  if (/sourc/.test(s)) return "sourcing";
  if (/estimate|100k/.test(s)) return "estimate";
  return "review";
}
function pmTopLane(status) {
  const s = norm(status).toLowerCase();
  if (/^draft/.test(s)) return "draft";
  if (/^delivered/.test(s)) return "delivered";
  if (/review/.test(s)) return "review";
  return "approved";
}
function pmIsClosed(status) { return /^(completed|ready to invoice|invoiced|cancel)/i.test(norm(status)); }

/* ---- small helpers ---- */
function pmToday() { return xtDayStart(new Date()); }
function pmDays(a, b) { return (a && b) ? Math.round((xtDayStart(b) - xtDayStart(a)) / 864e5) : null; }
function pmFmt(d, withYear) {
  if (!(d instanceof Date)) return "";
  const y = withYear || d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString("en-US", y ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
}
function pmMoney(n, full) {
  if (n == null || !isFinite(n)) return "—";
  if (full) return "$" + Math.round(n).toLocaleString("en-US");
  const a = Math.abs(n);
  if (a >= 1e6) return "$" + parseFloat((n / 1e6).toFixed(a >= 1e7 ? 1 : 2)) + "M";
  if (a >= 1e3) return "$" + parseFloat((n / 1e3).toFixed(a >= 1e5 ? 0 : 1)) + "K";
  return "$" + Math.round(n);
}
function pmShortName(n) {
  const p = norm(n).split(/\s+/).filter(Boolean);
  return p.length < 2 ? norm(n) : `${p[0][0]}. ${p[p.length - 1]}`;
}
function pmCountry(v) {
  const s = norm(v).split(" - ")[0];
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
function pmNum(wmtr) { const m = norm(wmtr).match(/(\d{5})(?:[-/](?:SRF|PR|PMCT|WS))?\s*$/i); return m ? m[1] : ""; }
function pmPlural(n, w) { return `${n} ${w}${n === 1 ? "" : "s"}`; }
function pmSum(rows, k) { return rows.reduce((s, r) => s + (r[k] || 0), 0); }
/** Oldest dated Activity Tracker entry whose Stage matches `re` (acts are newest first). */
function pmActDate(acts, re) {
  const m = acts.filter((a) => a.date && re.test(a.stage));
  return m.length ? m[m.length - 1].date : null;
}

/* -------------------------------------------------------------------------
   PARSE — one WMTR block = record row in col A down to the next record row.
   ------------------------------------------------------------------------- */
const PM_SEC_RE = /^(workflow logs|attachment list|atachment|inventory list|activity tracker list|request estimate list|cost list|linked request list|shipping activity & history)$/i;

/** Rows of the col-B section whose title matches `re` inside [rr, rEnd).
    Each row is an array starting at col B. Returns { hdr, rows }. */
function pmSection(grid, rr, rEnd, re) {
  for (let r = rr + 1; r < rEnd; r++) {
    if (!re.test(normWs(gridCell(grid, r, 2)))) continue;
    const take = (row) => { const out = []; for (let c = 2; c <= 14; c++) out.push(gridCell(grid, row, c)); return out; };
    const hdr = take(r + 1).map(normWs);
    const rows = [];
    for (let k = r + 2; k < rEnd; k++) {
      if (PM_SEC_RE.test(normWs(gridCell(grid, k, 2)))) break;
      const v = take(k);
      if (v.some((x) => norm(x))) rows.push(v);
    }
    return { hdr, rows };
  }
  return { hdr: [], rows: [] };
}

function pmBlocks(grid) {
  const max = gridMaxRow(grid);
  const starts = [];
  for (let r = 2; r <= max; r++) if (/^WMTR-/i.test(norm(gridCell(grid, r, 1)))) starts.push(r);
  return starts.map((rr, i) => ({ rr, rEnd: i + 1 < starts.length ? starts[i + 1] : max + 1 }));
}

/** Common pieces every PR / PMCT record carries. */
function pmBase(grid, H, rr, rEnd, svc) {
  const S = (h) => { const c = H[normWs(h)]; return c ? gridCell(grid, rr, c) : ""; };
  const wmtr = norm(gridCell(grid, rr, 1));
  const status = norm(S("Status"));
  const wfl = xtReadWorkflowLogs(grid, rr, rEnd);                 // newest first
  const att = pmSection(grid, rr, rEnd, /^(attachment list|atachment)$/i).rows
    .map((r) => ({ file: norm(r[1]), type: norm(r[2]), note: norm(r[3]), by: norm(r[4]), at: xtParseDate(r[5]) }));
  const act = pmSection(grid, rr, rEnd, /^activity tracker list$/i).rows
    .map((r, i) => ({ stage: norm(r[2]).replace(/�/g, "–"), date: xtParseDate(r[3]), note: norm(r[8]), i }))
    .filter((a) => a.date || a.note);
  const acts = act.slice().sort((a, b) => ((b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0)) || (a.i - b.i));
  const latest = acts.find((a) => a.note) || acts[0] || null;
  const eq = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
  const same = wfl.filter((e) => eq(e.status, status) && e.dt);
  const submitted = xtParseDate(S("Date Submitted"));
  const statusSince = same.length ? same[0].dt : (wfl.find((e) => e.dt) || {}).dt || submitted || null;
  const dateCompleted = xtParseDate(S("Date Completed"));
  const closeStamp = wfl.find((e) => e.dt && pmIsClosed(e.status));
  return {
    svc, wmtr, num: pmNum(wmtr), status, closed: pmIsClosed(status),
    title: norm(S("Request Title")), poc: norm(S("TTI POC Name")) || "Unassigned",
    alt: norm(S("TTI Alternate POC Name")),
    country: pmCountry(S("Country of Destination") || S("CTR Country")),
    program: norm(S("CTR Program")),
    ref: norm(S("Requestor Ref.#")),
    redFlag: /^true$/i.test(norm(S("Red Flag"))), redFlagNote: norm(S("Red Flag Comments")),
    topReq: /^(yes|true)$/i.test(norm(S("Transfer of Property (TOP) Required?"))),
    topComments: norm(S("TOP Comments")),
    rdd: xtParseDate(S("NLT Completion Date")),
    submitted, statusSince, wfl, att, acts, latest,
    lastUpdate: acts.length ? acts.find((a) => a.date)?.date || null : null,
    closedDate: dateCompleted || (closeStamp ? closeStamp.dt : null),
    S,
  };
}

function pmParsePr(grid) {
  const H = buildHeaderMap(grid, 1);
  const out = [];
  for (const { rr, rEnd } of pmBlocks(grid)) {
    const wm = norm(gridCell(grid, rr, 1));
    if (xtServiceTag(wm) !== "PR") continue;                        // same gate as the Christmas Tree
    const b = pmBase(grid, H, rr, rEnd, "PR");
    const eq = (a, n) => norm(a).toLowerCase() === n.toLowerCase();
    const newest = (n) => { const e = b.wfl.find((x) => eq(x.status, n) && x.dt); return e ? e.dt : null; };
    const oldest = (n) => { const m = b.wfl.filter((x) => eq(x.status, n) && x.dt); return m.length ? m[m.length - 1].dt : null; };
    const approvedCosts = b.wfl.filter((x) => eq(x.status, "DTRA Estimate Review (Approved)") && x.cost);
    const pos = b.att.filter((a) => /purchase order/i.test(a.type) && a.at).map((a) => a.at).sort((x, y) => x - y);
    const pods = b.att.filter((a) => /proof of delivery/i.test(a.type) && a.at).map((a) => a.at).sort((x, y) => x - y);
    const poAct = pmActDate(b.acts, /po issued/i);                  // Activity Tracker "PR – PO Issued"
    const r = Object.assign(b, {
      lane: pmPrLane(b.status),
      cost: toFloat(b.S("Total Cost in USD")) || 0,
      approved: approvedCosts.length ? approvedCosts[0].cost : null,
      complianceApproved: newest("DTRA Compliance Review (Approved)"),
      estSubmitted: oldest("DTRA Estimate Review"),
      estApproved: newest("DTRA Estimate Review (Approved)"),
      ct100k: newest("CT Program > 100K Approval (Approved)"),
      // PO issued: the earlier of the Activity Tracker "PO Issued" stage and the PO file upload
      // (a PO can't be uploaded before it's issued), else the oldest Production or Delivery log.
      poDate: [poAct, pos[0]].filter(Boolean).sort((x, y) => x - y)[0] || oldest("Production or Delivery"),
      poAttached: !!poAct || pos.length > 0,
      // POD: the Delivery Date field, else the Activity Tracker "Delivered - POD Received" stage, else the POD file upload.
      podDate: xtParseDate(b.S("Delivery Date")) || pmActDate(b.acts, /delivered - pod received/i) || pods[0] || null,
    });
    // Estimate due = 3 business days after compliance approval (Christmas Tree PR rule);
    // re-estimates count from when the request came back to TTI.
    if (/^tti estimate preparation$/i.test(r.status)) {
      const base = [r.complianceApproved, r.statusSince].filter(Boolean).sort((x, y) => y - x)[0];
      r.estDue = base ? xtWorkday(base, 3, true) : null;
    }
    // PO due = 1 business day after the estimate is approved (Christmas Tree PO rule).
    if (r.lane === "sourcing" && !r.poAttached) {
      const base = r.estApproved || r.statusSince;
      r.poDue = base ? xtWorkday(base, 1, false) : null;
    }
    delete r.S;
    out.push(r);
  }
  return out;
}

function pmParsePmct(grid) {
  const H = buildHeaderMap(grid, 1);
  const out = [];
  for (const { rr, rEnd } of pmBlocks(grid)) {
    const wm = norm(gridCell(grid, rr, 1));
    if (xtServiceTag(wm) !== "PMCT") continue;
    const b = pmBase(grid, H, rr, rEnd, "PMCT");
    let value = toFloat(b.S("Value of Cargo (USD)"));
    if (!value) {                                                      // fall back to the inventory
      const inv = pmSection(grid, rr, rEnd, /^inventory list$/i);
      const qi = inv.hdr.findIndex((h) => /^quantity$/i.test(h));
      const vi = inv.hdr.findIndex((h) => /^value/i.test(h));
      if (qi >= 0 && vi >= 0) value = inv.rows.reduce((s, x) => s + toFloat(x[qi]) * toFloat(x[vi]), 0);
    }
    const delivered = b.wfl.filter((e) => /^delivered - pod received$/i.test(e.status) && e.dt);
    const pod = b.att.filter((a) => /proof of delivery|in lieu of pod/i.test(a.type + " " + a.note) && a.at).map((a) => a.at).sort((x, y) => x - y);
    const text = `${b.title} ${b.ref}`;
    const nums = Array.from(new Set((text.match(/\b\d{5}\b/g) || []).filter((n) => n !== b.num)));
    const r = Object.assign(b, {
      lane: pmTopLane(b.status),
      value: value || 0,
      // Delivered: the Delivery Date field, else the oldest "Delivered - POD Received" log, else the POD file upload.
      delivered: xtParseDate(b.S("Delivery Date")) || (delivered.length ? delivered[delivered.length - 1].dt : (pod[0] || null)),
      // TOP hand-off milestones, from Activity Tracker stages.
      xferScheduled: pmActDate(b.acts, /transfer scheduled/i),
      xferAcked: pmActDate(b.acts, /acknowledged by receiving/i),
      xferDone: pmActDate(b.acts, /transfer completed/i),
      srcNums: nums,
      srfNums: nums.filter((n) => new RegExp(`${n}-SRF`, "i").test(text)),
      form: /1150/.test(`${b.topComments} ${b.title}`) ? "DD1150" : /1149/.test(`${b.topComments} ${b.title}`) ? "DD1149" : "TOP",
    });
    delete r.S;
    out.push(r);
  }
  return out;
}

/** Flags = what needs attention. lvl "red" | "amber"; key drives the KPI filters. */
function pmPrFlags(r, today) {
  const f = [];
  if (r.redFlag) f.push({ lvl: "red", key: "flag", text: `Red flag${r.redFlagNote ? ": " + r.redFlagNote : ""}` });
  if (r.estDue) {
    const d = pmDays(today, r.estDue);
    if (d < 0) f.push({ lvl: "red", key: "estdue", text: `Estimate overdue (due ${pmFmt(r.estDue)})` });
    else if (d <= PM_SOON_DAYS) f.push({ lvl: "amber", key: "estdue", text: `Estimate due ${d === 0 ? "today" : pmFmt(r.estDue)}` });
  }
  if (r.poDue && pmDays(today, r.poDue) < 0) f.push({ lvl: "red", key: "podue", text: `PO overdue (due ${pmFmt(r.poDue)})` });
  if (r.lane === "sourcing" && r.poAttached) f.push({ lvl: "amber", key: "status", text: "PO issued — status still Sourcing" });
  if (r.rdd && !r.podDate && r.lane !== "draft") {
    const d = pmDays(today, r.rdd);
    if (d < 0) f.push({ lvl: "red", key: "rdd", text: `Past RDD (${pmFmt(r.rdd)})` });
    else if (d <= PM_RDD_SOON_DAYS) f.push({ lvl: "amber", key: "rdd", text: d === 0 ? "RDD today" : `RDD in ${pmPlural(d, "day")}` });
  }
  if (r.lane !== "draft") {
    if (!r.lastUpdate) f.push({ lvl: "amber", key: "stale", text: "No Activity Tracker updates" });
    else if (pmDays(r.lastUpdate, today) > PM_STALE_DAYS) f.push({ lvl: "amber", key: "stale", text: `No update in ${pmDays(r.lastUpdate, today)} days` });
  }
  if (r.topReq && r.podDate && !r.pmcts.length) f.push({ lvl: "amber", key: "notop", text: "TOP required — no PMCT yet" });
  return f;
}
function pmTopFlags(r, today) {
  const f = [];
  if (r.redFlag) f.push({ lvl: "red", key: "flag", text: `Red flag${r.redFlagNote ? ": " + r.redFlagNote : ""}` });
  if (r.lane === "delivered") {
    if (!r.delivered) f.push({ lvl: "amber", key: "nodate", text: "Delivered – date unknown" });
    if (r.age > 30) f.push({ lvl: "red", key: "a31", text: `Open ${r.age} days since delivery` });
    else if (r.age > 15) f.push({ lvl: "amber", key: "a30", text: `Open ${r.age} days since delivery` });
    if (!r.value) f.push({ lvl: "amber", key: "novalue", text: "No property value recorded" });
  }
  if (r.lane !== "draft") {
    if (!r.lastUpdate) f.push({ lvl: "amber", key: "stale", text: "No Activity Tracker updates" });
    else if (pmDays(r.lastUpdate, today) > PM_STALE_DAYS) f.push({ lvl: "amber", key: "stale", text: `No update in ${pmDays(r.lastUpdate, today)} days` });
  }
  return f;
}

/** Everything both tabs need, rebuilt only when a slot changes. */
let _pmCache = null;
function pmData() {
  const prSlot = XTree.slots.PR, pmSlot = XTree.slots.PMCT;
  const key = new Date().toDateString();
  if (_pmCache && _pmCache.pr === prSlot && _pmCache.pm === pmSlot && _pmCache.key === key) return _pmCache.data;
  const today = pmToday();
  const prs = prSlot && prSlot.grid ? pmParsePr(prSlot.grid) : [];
  const tops = pmSlot && pmSlot.grid ? pmParsePmct(pmSlot.grid) : [];
  const prByNum = {};
  for (const p of prs) prByNum[p.num] = p;
  for (const p of prs) p.pmcts = [];
  for (const t of tops) {
    t.srcPr = t.srcNums.filter((n) => prByNum[n] && t.srfNums.indexOf(n) === -1);
    t.source = t.srcPr.length ? `PR ${t.srcPr[0]}` : t.srfNums.length ? `SRF ${t.srfNums[0]}` : t.srcNums.length ? `#${t.srcNums[0]}` : "";
    if (!/^cancel/i.test(t.status)) for (const n of t.srcPr) prByNum[n].pmcts.push(t);
    t.age = t.lane === "delivered" && t.delivered ? pmDays(t.delivered, today) : null;
    t.bucket = t.lane !== "delivered" ? "pre" : t.age == null ? "unk" : t.age > 30 ? "a31" : t.age > 15 ? "a30" : "a15";
  }
  for (const p of prs) p.flags = pmPrFlags(p, today);
  for (const t of tops) t.flags = pmTopFlags(t, today);
  // Delivered (or closed) PRs that need a TOP but no PMCT points at them — every PR, no start date.
  const noTop = prs.filter((p) => p.topReq && !p.pmcts.length && !/^cancel/i.test(p.status) && (p.podDate || p.closedDate));
  const data = { prs, tops, noTop, today, prSlot, pmSlot };
  _pmCache = { pr: prSlot, pm: pmSlot, key, data };
  return data;
}

/* -------------------------------------------------------------------------
   AUTO-PULL — opening either tab pulls both UDQs from ATLAS (background).
   ------------------------------------------------------------------------- */
const PmPull = { busy: false };
function pmFresh(slot) { return slot && slot.at && Date.now() - slot.at < PM_AUTO_PULL_MIN * 60000; }
async function pmAutoPull(force) {
  if (PmPull.busy || typeof loadFromAtlasXmasTree !== "function") return;
  const pr = XTree.slots.PR, pm = XTree.slots.PMCT;
  if (!force) {
    if (pmFresh(pr) && pmFresh(pm)) return;                     // pulled moments ago
    if ((pr && !pr.at) || (pm && !pm.at)) return;               // working from dropped files — leave them
  }
  PmPull.busy = true;
  if (pmIsTool(AppState.activeTool)) renderWorkspace();
  try { await loadFromAtlasXmasTree({ services: ["PR", "PMCT"], quiet: true }); }
  catch (e) { console.error(e); xtSetStatus(`Couldn't pull the PR / PMCT UDQs from ATLAS — ${e.message || e}`, true); }
  PmPull.busy = false;
  if (pmIsTool(AppState.activeTool)) renderWorkspace();
}

/* -------------------------------------------------------------------------
   UI STATE
   ------------------------------------------------------------------------- */
const PmUi = {
  proc: { view: "active", poc: "", q: "", drafts: false, attn: false, quick: "", sort: { k: "", d: 1 }, open: new Set(), period: "90" },
  prop: { view: "active", poc: "", q: "", drafts: false, attn: false, quick: "", sort: { k: "", d: 1 }, open: new Set(), period: "90" },
  slide: false,
  slideFiltered: false,     // weekly slide: use each tab's filters instead of the whole contract
};
function pmRerender() { if (pmIsTool(AppState.activeTool)) renderWorkspace(); }

const PMX_CSS = `
.pmx{--pm-r1:#86b6ef;--pm-r2:#3987e5;--pm-r3:#1c5cab;--pm-r4:#0d366b;--pm-grid:#e3e8ef}
body.theme-dark .pmx{--pm-grid:#2a3744}
.pmx-top{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;border-bottom:2px solid var(--ax-line);margin-top:-4px}
.pmx-top .copx-tabs{border-bottom:0;margin-top:0}
.pmx-tools{display:flex;gap:8px;align-items:center;margin-left:auto;padding-bottom:6px;flex-wrap:wrap}
.pmx-tools .copx-btn{min-height:32px;padding:6px 14px}
.pmx-src{font-size:11.5px;color:var(--ax-muted)}
.pmx-filters{display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin-bottom:14px}
.pmx-filters .copx-f{min-width:180px}
.pmx-filters .copx-f.q{flex:1;min-width:220px}
.pmx-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}
.pmx-kpi{border:1px solid var(--ax-line);background:var(--ax-card);border-radius:10px;padding:10px 14px;text-align:left;cursor:pointer;color:var(--ax-ink);font:inherit;transition:box-shadow .1s}
.pmx-kpi:hover{box-shadow:0 0 0 3px rgba(30,90,168,.15)}
.pmx-kpi.on{border-color:var(--ax-blue);box-shadow:0 0 0 2px var(--ax-blue)}
.pmx-kpi .k{font-size:11.5px;color:var(--ax-muted);font-weight:600;display:flex;align-items:center;gap:6px}
.pmx-kpi .v{font-size:26px;font-weight:700;line-height:1.15;margin-top:2px}
.pmx-kpi .s{font-size:11.5px;color:var(--ax-ink2)}
.pmx-kpi .s b.r{color:var(--ax-red)} .pmx-kpi .s b.a{color:var(--ax-amber)}
.pmx-dot{width:9px;height:9px;border-radius:50%;display:inline-block;flex:none}
.pmx-lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:18px}
.pmx-lane{border:1px solid var(--ax-line);border-radius:10px;background:var(--ax-soft);overflow:hidden;cursor:pointer;text-align:left;padding:0;font:inherit;color:var(--ax-ink)}
.pmx-lane.on{box-shadow:0 0 0 2px var(--ax-blue);border-color:var(--ax-blue)}
.pmx-lane .lh{background:var(--ax-navy);color:#fff;padding:8px 12px;display:flex;align-items:center;gap:8px;font-weight:600;font-size:12.5px}
.pmx-lane .lb{padding:8px 12px 10px}
.pmx-lane .n{font-size:24px;font-weight:700;line-height:1.1}
.pmx-lane .m{font-size:12px;color:var(--ax-ink2);margin-bottom:6px}
.pmx-lane .st{font-size:11px;color:var(--ax-muted);display:flex;justify-content:space-between;gap:6px}
.pmx-grid2{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:16px}
@media (max-width:1100px){.pmx-grid2{grid-template-columns:1fr}}
.pmx-panel{border:1px solid var(--ax-line);border-radius:10px;padding:12px 14px;background:var(--ax-card);min-width:0}
.pmx-panel h3{margin:0 0 2px;font-size:14px;font-weight:600}
.pmx-panel .sub{font-size:11.5px;color:var(--ax-muted);margin-bottom:8px}
.pmx-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11.5px;color:var(--ax-ink2);margin:4px 0 8px}
.pmx-legend span{display:inline-flex;align-items:center;gap:5px}
.pmx-svg{width:100%;height:auto;display:block}
.pmx-svg text{font-family:inherit;fill:var(--ax-ink2);font-size:11px}
.pmx-svg .ax{fill:var(--ax-muted);font-size:10px}
.pmx-svg .nm{fill:var(--ax-ink);font-size:11.5px}
.pmx-svg .gl{stroke:var(--pm-grid);stroke-width:1}
.pmx-svg circle{stroke:var(--ax-card);stroke-width:2;cursor:pointer}
.pmx-svg circle:hover{stroke:var(--ax-ink)}
.pmx-svg circle.zero{fill:var(--ax-card)!important;stroke:var(--ax-muted);stroke-width:1.5}
.pmx-bars{display:flex;flex-direction:column;gap:7px}
.pmx-bar{display:grid;grid-template-columns:130px minmax(0,1fr) 110px;gap:10px;align-items:center;font-size:12px}
.pmx-bar .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pmx-bar .tr{display:flex;gap:2px;height:20px}
.pmx-bar .sg{height:100%;color:#fff;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;min-width:3px;cursor:default}
.pmx-bar .sg:last-child{border-radius:0 4px 4px 0}
.pmx-bar .tot{color:var(--ax-ink2);text-align:right;white-space:nowrap}
.pmx-act h4{margin:10px 0 4px;font-size:12.5px;display:flex;justify-content:space-between}
.pmx-act h4:first-child{margin-top:0}
.pmx-act ul{list-style:none;margin:0;padding:0}
.pmx-act li{display:flex;gap:8px;align-items:baseline;padding:4px 0;border-bottom:1px solid var(--ax-line2);font-size:12px;cursor:pointer}
.pmx-act li:hover{background:var(--ax-acc2)}
.pmx-act li .w{font-weight:700;min-width:44px}
.pmx-act li .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ax-ink2)}
.pmx-act li .d{white-space:nowrap;font-weight:600}
.pmx-act .none{font-size:12px;color:var(--ax-muted);font-style:italic;padding:4px 0}
.pmx-ages{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:6px}
.pmx-age{border-radius:8px;padding:8px 10px;background:var(--ax-soft);border:1px solid var(--ax-line2);cursor:pointer;text-align:left;font:inherit;color:var(--ax-ink)}
.pmx-age.on{box-shadow:0 0 0 2px var(--ax-blue)}
.pmx-age .k{font-size:11px;color:var(--ax-muted);font-weight:600;display:flex;gap:6px;align-items:center}
.pmx-age .v{font-size:20px;font-weight:700}
.pmx-age .s{font-size:11.5px;color:var(--ax-ink2)}
.pmx-tbl{width:100%;border-collapse:collapse;font-size:12px}
.pmx-tbl th{background:var(--ax-th);color:#fff;text-align:left;padding:7px 8px;font-weight:600;white-space:nowrap;cursor:pointer;user-select:none;position:sticky;top:0}
.pmx-tbl th.num,.pmx-tbl td.num{text-align:right}
.pmx-tbl td{padding:7px 8px;border-bottom:1px solid var(--ax-line2);vertical-align:top}
.pmx-tbl tr.row{cursor:pointer}
.pmx-tbl tr.row:hover td{background:var(--ax-acc2)}
.pmx-tbl tr.row.open td{background:var(--ax-acc)}
.pmx-tbl .w{font-weight:700;white-space:nowrap}
.pmx-tbl .tt{color:var(--ax-ink2);font-size:11.5px;min-width:200px;max-width:300px}
.pmx-tbl .note{min-width:220px;max-width:340px;color:var(--ax-ink2)}
.pmx-tbl .note .clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.pmx-tbl .note b{color:var(--ax-ink);font-weight:600}
.pmx-wrap{overflow:auto;max-height:70vh;border:1px solid var(--ax-line);border-radius:8px}
.pmx-pill{display:inline-block;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:600;margin:1px 3px 1px 0;white-space:nowrap}
.pmx-pill.red{background:var(--ax-red-soft);color:var(--ax-red)}
.pmx-pill.amber{background:var(--ax-amber-soft);color:var(--ax-amber)}
.pmx-pill.big{background:var(--ax-purple-soft);color:var(--ax-purple)}
.pmx-pill.ok{background:var(--ax-green-soft);color:var(--ax-green)}
.pmx-st{display:flex;align-items:center;gap:6px;white-space:nowrap}
.pmx-st small{display:block;color:var(--ax-muted);font-size:11px;padding-left:15px}
.pmx-det td{background:var(--ax-soft)!important;padding:12px 16px 16px}
.pmx-dg{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px 24px}
.pmx-dg h5{margin:0 0 6px;font-size:12px;color:var(--ax-muted);text-transform:uppercase;letter-spacing:.4px}
.pmx-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12px}
.pmx-kv span:nth-child(odd){color:var(--ax-muted)}
.pmx-notes{list-style:none;margin:0;padding:0;font-size:12px}
.pmx-notes li{padding:3px 0;border-bottom:1px dashed var(--ax-line2)}
.pmx-notes li b{white-space:nowrap}
.pmx-empty{padding:18px;text-align:center;color:var(--ax-muted);font-style:italic}
.pmx-drop{border:2px dashed #9fbbe0;border-radius:10px;padding:22px;text-align:center;color:var(--ax-ink2);background:var(--ax-acc2);cursor:pointer}
.pmx-drop.dragover{background:var(--ax-acc);border-color:var(--ax-blue)}
.pmx-status{font-size:12px;color:var(--ax-ink2);margin-top:10px}
.pmx-status.err{color:var(--ax-red)}
.pmx-tip{position:fixed;z-index:9999;pointer-events:none;background:#1e2a4a;color:#fff;border-radius:6px;padding:7px 10px;font-size:12px;max-width:320px;box-shadow:0 4px 14px rgba(0,0,0,.25);line-height:1.4}
.pmx-tip b{font-weight:700}
/* weekly slide */
.pmx-slide{container-type:inline-size;aspect-ratio:16/9;width:100%;max-width:1000px;margin:0 auto 14px;background:#fff;color:#1f2d3d;border-radius:6px;
  box-shadow:0 2px 10px rgba(20,30,60,.22);padding:2.2cqw 3.7cqw 1.6cqw;display:flex;flex-direction:column;font-family:Calibri,"Segoe UI",sans-serif}
.pmx-slide .top{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.4cqw}
.pmx-slide .top h1{margin:0;font-size:2.6cqw;color:#1e2a4a;font-weight:700}
.pmx-slide .top span{font-size:1.3cqw;color:#5a6778}
.pmx-slide .quads{flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1.3fr 1fr;gap:1.6cqw;min-height:0}
.pmx-slide .q{background:#f4f6fa;border:1px solid #e1e6ee;border-radius:.9cqw;padding:1.1cqw 1.4cqw;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.pmx-slide .qh{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.6cqw}
.pmx-slide .qh b{font-size:1.5cqw;color:#1e2a4a}
.pmx-slide .qh span{font-size:1.05cqw;color:#5a6778}
.pmx-slide .qb{flex:1;display:grid;grid-template-columns:1.15fr 1fr;gap:1.2cqw;min-height:0}
.pmx-slide .qb.one{grid-template-columns:1fr}
.pmx-slide .ct{font-size:.95cqw;font-weight:700;color:#1f2d3d;margin-bottom:.4cqw}
.pmx-slide .sb{display:grid;grid-template-columns:7cqw 1fr;gap:.3cqw .6cqw;align-items:center;font-size:.9cqw}
.pmx-slide .sb .tr{display:flex;gap:.12cqw;height:1.25cqw}
.pmx-slide .sb .sg{height:100%;color:#fff;font-size:.75cqw;display:flex;align-items:center;justify-content:center}
.pmx-slide .lg{display:flex;flex-wrap:wrap;gap:.3cqw .9cqw;font-size:.75cqw;color:#5a6778;margin-top:.5cqw}
.pmx-slide .lg i{display:inline-block;width:.8cqw;height:.8cqw;border-radius:50%;margin-right:.3cqw;vertical-align:middle}
.pmx-slide ul{margin:0;padding-left:1.2cqw;font-size:.95cqw;line-height:1.35}
.pmx-slide .lh{font-size:.95cqw;font-weight:700;margin:.2cqw 0 .15cqw;color:#1e2a4a}
.pmx-slide .muted{color:#8a94a3;font-style:italic;font-size:.95cqw}
.pmx-slide .tiles{display:grid;grid-template-columns:1fr 1fr;gap:.5cqw;margin-bottom:.4cqw}
.pmx-slide .tile{background:#fff;border-radius:.5cqw;padding:.4cqw .6cqw;font-size:.75cqw;color:#5a6778}
.pmx-slide .tile b{display:block;font-size:1.5cqw;color:#1f2d3d}
.pmx-slide .tile b.r{color:#c62828}
.pmx-slide .foot{font-size:.75cqw;color:#8a94a3;margin-top:.6cqw}
.pmx-sedit{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:800px){.pmx-sedit{grid-template-columns:1fr}}
.pmx-sedit label{display:block;font-size:12px;font-weight:600;margin-bottom:4px}
.pmx-sedit textarea,.pmx-sedit input{width:100%;border:1px solid #c9d2de;border-radius:6px;padding:8px 10px;font:inherit;font-size:12.5px;background:var(--ax-card);color:var(--ax-ink)}
.pmx-sedit textarea{min-height:92px;resize:vertical}
.pmx-sedit .hint{font-size:11px;color:var(--ax-muted);margin-top:3px}
`;

/* Shared tooltip */
function pmTip(e, html) {
  let t = document.getElementById("pmxTip");
  if (!html) { if (t) t.remove(); return; }
  if (!t) { t = document.createElement("div"); t.id = "pmxTip"; t.className = "pmx-tip"; document.body.appendChild(t); }
  t.innerHTML = html;
  const x = Math.min(e.clientX + 14, window.innerWidth - t.offsetWidth - 8);
  const y = e.clientY + 16 + t.offsetHeight > window.innerHeight ? e.clientY - t.offsetHeight - 10 : e.clientY + 16;
  t.style.left = x + "px"; t.style.top = y + "px";
}
function pmWireTips(root) {
  root.querySelectorAll("[data-tip]").forEach((n) => {
    n.addEventListener("mousemove", (e) => pmTip(e, n.getAttribute("data-tip")));
    n.addEventListener("mouseleave", () => pmTip(null));
  });
}

/* -------------------------------------------------------------------------
   RENDER
   ------------------------------------------------------------------------- */
function renderProcWorkspace(container) { pmRender(container, "proc"); }
function renderPropWorkspace(container) { pmRender(container, "prop"); }

function pmRender(container, kind) {
  pmTip(null);
  const ui = PmUi[kind];
  const isPr = kind === "proc";
  const root = el(`<div class="copx pmx"><style>${typeof COPX_CSS !== "undefined" ? COPX_CSS : ""}${PMX_CSS}</style></div>`);
  container.appendChild(root);
  const D = pmData();
  const slot = isPr ? D.prSlot : D.pmSlot;
  const all = isPr ? D.prs : D.tops;

  if (!slot) { root.appendChild(pmEmptyCard(kind)); return; }

  const active = all.filter((r) => !r.closed);
  const closed = all.filter((r) => r.closed);
  const drafts = active.filter((r) => r.lane === "draft").length;
  const isActive = ui.view !== "closed";
  const noun = isPr ? "PR" : "TOP";

  const pulled = slot.at ? `pulled ${new Date(slot.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "dropped file";
  const tabs = el(`<div class="pmx-top"><div class="copx-tabs" role="tablist">
    <button type="button" data-v="active" class="${isActive ? "on" : ""}" role="tab" aria-selected="${isActive}">Active ${noun}s (${active.length - (ui.drafts ? 0 : drafts)})</button>
    <button type="button" data-v="closed" class="${!isActive ? "on" : ""}" role="tab" aria-selected="${!isActive}">Closed ${noun}s (${closed.length})</button></div>
    <div class="pmx-tools"><span class="pmx-src">${esc(isPr ? "PR" : "PMCT")} UDQ · ${esc(pulled)}${PmPull.busy ? " · refreshing…" : ""}</span>
      <button class="copx-btn ghost" type="button" id="pmRefresh" ${PmPull.busy ? "disabled" : ""}>Refresh</button>
      <button class="copx-btn ${PmUi.slide ? "blue" : "green"}" type="button" id="pmSlideBtn">${PmUi.slide ? "Close weekly slide" : "Weekly slide"}</button></div>
  </div>`);
  tabs.querySelectorAll("button[data-v]").forEach((b) => b.addEventListener("click", () => {
    ui.view = b.dataset.v; ui.quick = ""; ui.open = new Set(); pmRerender();
  }));
  tabs.querySelector("#pmRefresh").addEventListener("click", () => pmAutoPull(true));
  tabs.querySelector("#pmSlideBtn").addEventListener("click", () => { PmUi.slide = !PmUi.slide; pmRerender(); });
  root.appendChild(tabs);
  root.appendChild(el(`<div class="pmx-status ${XTree.statusErr ? "err" : ""}" id="xtStatus" style="margin-top:-8px">${esc(XTree.status || "")}</div>`));

  if (PmUi.slide) root.appendChild(pmSlideCard(D));

  const base = isActive ? active.filter((r) => ui.drafts || r.lane !== "draft") : pmClosedWindow(closed, ui.period);
  const rows = pmFilter(base, ui, isPr);

  const card = el(`<section class="copx-card">
    <div class="copx-hd"><h2>${isPr ? (isActive ? "Procurement — Active PRs" : "Procurement — Closed PRs") : (isActive ? "Property — Open TOPs (PMCT)" : "Property — Closed TOPs (PMCT)")}</h2>
      <span class="n">${rows.length === base.length ? pmPlural(base.length, noun) : `${rows.length} of ${base.length} ${noun}s`} · ${pmMoney(pmSum(rows, isPr ? "cost" : "value"))}</span>
      <div class="acts"><button class="copx-btn" id="pmExport" type="button">Export to Excel</button></div></div>
    <div class="copx-rule"></div></section>`);
  root.appendChild(card);
  card.querySelector("#pmExport").addEventListener("click", () => pmExportXlsx(kind, rows, isActive));
  card.appendChild(pmFilterBar(kind, isActive ? active : closed, isActive, drafts));

  if (isActive) {
    const viewBase = pmFilter(base, Object.assign({}, ui, { quick: "", attn: false }), isPr);  // tiles count what the filters show, before a tile is picked
    card.appendChild(isPr ? pmPrKpis(viewBase, ui) : pmTopKpis(viewBase, ui));
    card.appendChild(pmLanes(viewBase, ui, isPr));
    const g = el(`<div class="pmx-grid2"></div>`);
    g.appendChild(isPr ? pmPrDotPlot(viewBase) : pmTopBars(viewBase));
    g.appendChild(isPr ? pmPrActions(viewBase) : pmTopActions(viewBase, D));
    card.appendChild(g);
  }

  const tcard = el(`<section class="copx-card"><div class="copx-hd"><h2>${isActive ? (isPr ? "PR details" : "TOP details") : "Closed"}</h2>
    <span class="n">Click a row for dates, linked requests and the update history · click a header to sort</span></div><div class="copx-rule"></div></section>`);
  root.appendChild(tcard);
  tcard.appendChild(pmTable(kind, rows, isActive));
  pmWireTips(root);
}

function pmEmptyCard(kind) {
  const isPr = kind === "proc";
  const busy = PmPull.busy;
  const card = el(`<section class="copx-card">
    <div class="copx-hd"><h2>${isPr ? "Procurement" : "Property (TOP)"}</h2></div><div class="copx-rule"></div>
    <p class="copx-msg">${busy ? "Pulling the PR and PMCT UDQs from ATLAS…" :
      "This tab runs on the PR and PMCT UDQs (the same ones the Christmas Tree uses). Inside ATLAS they pull automatically when you open the tab. Elsewhere, drop the two UDQ exports below."}</p>
    <div class="copx-fbtns" style="margin:10px 0 14px"><button class="copx-btn green" id="pmFetch" type="button" ${busy ? "disabled" : ""}>Pull from ATLAS</button></div>
    <div class="pmx-drop" id="pmDrop" tabindex="0" role="button">Drop the PR and PMCT UDQ exports (.xlsx) here, or click to browse</div>
    <input type="file" id="pmFile" accept=".xlsx,.xls" multiple hidden>
    <div class="pmx-status ${XTree.statusErr ? "err" : ""}" id="xtStatus">${esc(XTree.status || "")}</div>
  </section>`);
  card.querySelector("#pmFetch").addEventListener("click", () => pmAutoPull(true));
  pmWireDrop(card.querySelector("#pmDrop"), card.querySelector("#pmFile"));
  return card;
}
function pmWireDrop(drop, input) {
  const take = (files) => { if (files && files.length && typeof xtIngestFiles === "function") xtIngestFiles(files); };
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => take(input.files));
  for (const ev of ["dragover", "dragenter"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("dragover"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("dragover"); });
  drop.addEventListener("drop", (e) => take(e.dataTransfer && e.dataTransfer.files));
}

function pmClosedWindow(rows, period) {
  if (period === "all") return rows;
  const today = pmToday();
  let from;
  if (period === "fy") { from = new Date(today.getFullYear() - (today.getMonth() < 9 ? 1 : 0), 9, 1); }
  else from = xtAddDays(today, -parseInt(period, 10));
  return rows.filter((r) => r.closedDate && r.closedDate >= from);
}

function pmFilter(rows, ui, isPr) {
  const q = norm(ui.q).toLowerCase();
  let out = rows.filter((r) => {
    if (ui.poc && r.poc !== ui.poc) return false;
    if (ui.attn && !r.flags.length) return false;
    if (q && ![r.wmtr, r.title, r.poc, r.status, r.country, r.program, r.latest ? r.latest.note : "", r.source || ""].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
  const k = ui.quick;
  if (k) {
    if (k.startsWith("lane:")) out = out.filter((r) => r.lane === k.slice(5));
    else if (k.startsWith("age:")) out = out.filter((r) => r.bucket === k.slice(4));
    else if (k === "big") out = out.filter((r) => (isPr ? r.cost >= PM_BIG_PR : r.value >= PM_BIG_TOP));
    else if (k === "attn") out = out.filter((r) => r.flags.length);
    else if (k === "estdue") out = out.filter((r) => r.flags.some((f) => f.key === "estdue"));
    else if (k === "podue") out = out.filter((r) => r.poDue && pmDays(pmToday(), r.poDue) <= PM_SOON_DAYS);
    else if (k === "rdd") out = out.filter((r) => r.flags.some((f) => f.key === "rdd" && f.lvl === "red"));   // matches the "Past RDD" tile
    else out = out.filter((r) => r.flags.some((f) => f.key === k));
  }
  // sort
  const s = ui.sort;
  if (s.k) {
    const val = (r) => {
      const v = r[s.k];
      if (v instanceof Date) return v.getTime();
      if (s.k === "latest") return r.lastUpdate ? r.lastUpdate.getTime() : 0;
      if (s.k === "flags") return r.flags.filter((f) => f.lvl === "red").length * 100 + r.flags.length;
      if (s.k === "lane") return (isPr ? PM_PR_LANES : PM_TOP_LANES).findIndex((l) => l.id === r.lane);
      return v == null ? "" : v;
    };
    out = out.slice().sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * s.d; });
  } else {
    out = out.slice().sort((a, b) => (b.flags.filter((f) => f.lvl === "red").length - a.flags.filter((f) => f.lvl === "red").length)
      || (b.flags.length - a.flags.length) || (parseInt(a.num, 10) - parseInt(b.num, 10)));
  }
  return out;
}

function pmFilterBar(kind, pool, isActive, drafts) {
  const ui = PmUi[kind];
  const pocs = Array.from(new Set(pool.map((r) => r.poc))).sort((a, b) => a.localeCompare(b));
  if (ui.poc && pocs.indexOf(ui.poc) === -1) ui.poc = "";
  const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(t)}</option>`;
  const bar = el(`<div class="pmx-filters">
    <div class="copx-f"><label for="pmPoc">${kind === "proc" ? "Buyer (TTI POC)" : "Owner (TTI POC)"}</label>
      <select id="pmPoc">${opt("", "Everyone", !ui.poc)}${pocs.map((p) => opt(p, p, p === ui.poc)).join("")}</select></div>
    <div class="copx-f q"><label for="pmQ">Search</label><input type="search" id="pmQ" placeholder="WMTR, title, country, note…" value="${esc(ui.q)}"></div>
    ${isActive ? `<label class="copx-chk"><input type="checkbox" id="pmAttn" ${ui.attn ? "checked" : ""}> Needs attention only</label>
      <label class="copx-chk"><input type="checkbox" id="pmDrafts" ${ui.drafts ? "checked" : ""}> Show drafts (${drafts})</label>`
    : `<div class="copx-f"><label for="pmPeriod">Closed in</label><select id="pmPeriod">
        ${opt("30", "Last 30 days", ui.period === "30")}${opt("90", "Last 90 days", ui.period === "90")}${opt("fy", "This fiscal year", ui.period === "fy")}${opt("all", "All time", ui.period === "all")}</select></div>`}
    ${ui.quick ? `<button class="copx-btn blue" type="button" id="pmClearQuick">Clear tile filter</button>` : ""}
  </div>`);
  bar.querySelector("#pmPoc").addEventListener("change", (e) => { ui.poc = e.target.value; pmRerender(); });
  const qi = bar.querySelector("#pmQ");
  let t = null;
  qi.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { ui.q = qi.value; pmRerender(); const n = document.getElementById("pmQ"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 300); });
  const a = bar.querySelector("#pmAttn"); if (a) a.addEventListener("change", () => { ui.attn = a.checked; pmRerender(); });
  const d = bar.querySelector("#pmDrafts"); if (d) d.addEventListener("change", () => { ui.drafts = d.checked; pmRerender(); });
  const p = bar.querySelector("#pmPeriod"); if (p) p.addEventListener("change", () => { ui.period = p.value; pmRerender(); });
  const c = bar.querySelector("#pmClearQuick"); if (c) c.addEventListener("click", () => { ui.quick = ""; pmRerender(); });
  return bar;
}

function pmKpiGrid(kind, tiles) {
  const ui = PmUi[kind];
  const g = el(`<div class="pmx-kpis"></div>`);
  for (const t of tiles) {
    const b = el(`<button type="button" class="pmx-kpi ${ui.quick === t.key ? "on" : ""}" ${t.key ? "" : 'style="cursor:default"'}>
      <div class="k">${t.dot ? `<i class="pmx-dot" style="background:${t.dot}"></i>` : ""}${esc(t.label)}</div>
      <div class="v">${esc(String(t.v))}</div><div class="s">${t.s || "&nbsp;"}</div></button>`);
    if (t.key) b.addEventListener("click", () => { ui.quick = ui.quick === t.key ? "" : t.key; pmRerender(); });
    g.appendChild(b);
  }
  return g;
}
function pmPrKpis(rows, ui) {
  const today = pmToday();
  const est = rows.filter((r) => r.flags.some((f) => f.key === "estdue"));
  const estLate = est.filter((r) => pmDays(today, r.estDue) < 0).length;
  const po = rows.filter((r) => r.poDue && pmDays(today, r.poDue) <= PM_SOON_DAYS);
  const poLate = po.filter((r) => pmDays(today, r.poDue) < 0).length;
  const rdd = rows.filter((r) => r.flags.some((f) => f.key === "rdd" && f.lvl === "red"));
  const big = rows.filter((r) => r.cost >= PM_BIG_PR);
  const attn = rows.filter((r) => r.flags.length);
  const late = (n) => n ? `<b class="r">${n} overdue</b>` : "none overdue";
  return pmKpiGrid("proc", [
    { label: "Open PRs", v: rows.length, s: `${pmMoney(pmSum(rows, "cost"))} total value` },
    { key: "estdue", label: `Estimates due ≤ ${PM_SOON_DAYS} days`, v: est.length, s: late(estLate) },
    { key: "podue", label: `POs expected ≤ ${PM_SOON_DAYS} days`, v: po.length, s: late(poLate) },
    { key: "rdd", label: "Past RDD", v: rdd.length, s: rdd.length ? pmMoney(pmSum(rdd, "cost")) : "&nbsp;" },
    { key: "big", label: "Over $100K", v: big.length, s: pmMoney(pmSum(big, "cost")) },
    { key: "attn", label: "Need attention", v: attn.length, s: `${attn.filter((r) => r.flags.some((f) => f.lvl === "red")).length} with a red item` },
  ]);
}
function pmTopKpis(rows, ui) {
  const dl = rows.filter((r) => r.lane === "delivered");
  const o30 = rows.filter((r) => r.bucket === "a31");
  const big = rows.filter((r) => r.value >= PM_BIG_TOP);
  const attn = rows.filter((r) => r.flags.length);
  return pmKpiGrid("prop", [
    { label: "Open TOPs", v: rows.length, s: `${pmMoney(pmSum(rows, "value"))} property value` },
    { key: "lane:delivered", label: "Delivered, TOP open", v: dl.length, s: pmMoney(pmSum(dl, "value")) },
    { key: "age:a31", label: "Open > 30 days", dot: "#c62828", v: o30.length, s: pmMoney(pmSum(o30, "value")) },
    { key: "big", label: "$200K and over", v: big.length, s: pmMoney(pmSum(big, "value")) },
    { key: "flag", label: "Red flags", v: rows.filter((r) => r.redFlag).length, s: "&nbsp;" },
    { key: "attn", label: "Need attention", v: attn.length, s: `${attn.filter((r) => r.flags.some((f) => f.lvl === "red")).length} with a red item` },
  ]);
}

function pmLanes(rows, ui, isPr) {
  const lanes = (isPr ? PM_PR_LANES : PM_TOP_LANES).filter((l) => l.id !== "draft" || ui.drafts);
  const kind = isPr ? "proc" : "prop";
  const wrap = el(`<div class="pmx-lanes"></div>`);
  for (const l of lanes) {
    const rs = rows.filter((r) => r.lane === l.id);
    const by = {};
    for (const r of rs) by[r.status] = (by[r.status] || 0) + 1;
    const st = Object.keys(by).sort((a, b) => by[b] - by[a]).slice(0, 3)
      .map((s) => `<div class="st"><span>${esc(s)}</span><b>${by[s]}</b></div>`).join("");
    const key = "lane:" + l.id;
    const b = el(`<button type="button" class="pmx-lane ${ui.quick === key ? "on" : ""}">
      <div class="lh"><i class="pmx-dot" style="background:${l.color};box-shadow:0 0 0 2px #fff"></i>${esc(l.label)}</div>
      <div class="lb"><div class="n">${rs.length}</div><div class="m">${pmMoney(pmSum(rs, isPr ? "cost" : "value"))}</div>${st}</div></button>`);
    b.addEventListener("click", () => { PmUi[kind].quick = PmUi[kind].quick === key ? "" : key; pmRerender(); });
    wrap.appendChild(b);
  }
  return wrap;
}

/* Open PRs by buyer — each dot is one PR at its value (log scale), coloured by step. */
function pmPrDotPlot(rows) {
  const panel = el(`<div class="pmx-panel"><h3>Open PRs by buyer</h3>
    <div class="sub">Each dot is one PR at its current total cost · hover for details, click to open it below</div></div>`);
  const lanes = PM_PR_LANES.filter((l) => rows.some((r) => r.lane === l.id));
  panel.appendChild(el(`<div class="pmx-legend">${lanes.map((l) => `<span><i class="pmx-dot" style="background:${l.color}"></i>${esc(l.label)}</span>`).join("")}
    <span><i class="pmx-dot" style="border:1.5px solid var(--ax-muted)"></i>No cost yet</span></div>`));
  if (!rows.length) { panel.appendChild(el(`<div class="pmx-empty">No open PRs in this view.</div>`)); return panel; }
  const by = {};
  for (const r of rows) (by[r.poc] = by[r.poc] || []).push(r);
  const names = Object.keys(by).sort((a, b) => pmSum(by[b], "cost") - pmSum(by[a], "cost"));
  const W = 640, L = 120, R = 92, ZW = 30, rowH = 30, top = 8, H = top + names.length * rowH + 24;
  const max = Math.max(1e3, ...rows.map((r) => r.cost));
  const lo = 3, hi = Math.max(4, Math.ceil(Math.log10(max)));
  const x0 = L + ZW + 22, x1 = W - R - 8;
  const X = (v) => x0 + (Math.log10(Math.max(v, 1e3)) - lo) / (hi - lo) * (x1 - x0);
  let svg = `<svg class="pmx-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Open PRs by buyer and value">`;
  for (let p = lo; p <= hi; p++) {
    const x = X(Math.pow(10, p));
    svg += `<line class="gl" x1="${x}" x2="${x}" y1="${top}" y2="${H - 22}"/><text class="ax" x="${x}" y="${H - 8}" text-anchor="middle">${pmMoney(Math.pow(10, p))}</text>`;
  }
  svg += `<text class="ax" x="${L + ZW / 2}" y="${H - 8}" text-anchor="middle">$0</text>`;
  names.forEach((n, i) => {
    const cy = top + i * rowH + rowH / 2;
    svg += `<line class="gl" x1="${L}" x2="${x1}" y1="${cy}" y2="${cy}" stroke-dasharray="2 3"/>`;
    svg += `<text class="nm" x="${L - 8}" y="${cy + 4}" text-anchor="end">${esc(n.length > 18 ? pmShortName(n) : n)}</text>`;
    const list = by[n].slice().sort((a, b) => a.cost - b.cost);
    let lastX = -99, k = 0;
    for (const r of list) {
      const x = r.cost > 0 ? X(r.cost) : L + ZW / 2;
      k = Math.abs(x - lastX) < 9 ? k + 1 : 0; lastX = x;
      const dy = k === 0 ? 0 : (k % 2 ? -1 : 1) * Math.min(9, 4 * Math.ceil(k / 2) + 2);
      const lane = PM_PR_LANES.find((l) => l.id === r.lane);
      const tip = `<b>${esc(r.num)}</b> · ${esc(r.title)}<br>${esc(r.status)} · ${pmMoney(r.cost, true)}${r.flags.length ? "<br>" + r.flags.map((f) => esc(f.text)).join("<br>") : ""}`;
      svg += `<circle data-num="${esc(r.num)}" data-tip="${esc(tip)}" class="${r.cost > 0 ? "" : "zero"}" cx="${x.toFixed(1)}" cy="${(cy + dy).toFixed(1)}" r="6" fill="${lane.color}"/>`;
    }
    svg += `<text x="${W - 4}" y="${cy + 4}" text-anchor="end"><tspan font-weight="700" fill="currentColor">${by[n].length}</tspan> · ${pmMoney(pmSum(by[n], "cost"))}</text>`;
  });
  svg += `</svg>`;
  const host = el(`<div>${svg}</div>`);
  host.querySelectorAll("circle").forEach((c) => c.addEventListener("click", () => pmOpenRow("proc", c.getAttribute("data-num"))));
  panel.appendChild(host);
  return panel;
}

/* Open TOPs by owner — stacked by how long since delivery; $ at the end. */
function pmTopBars(rows) {
  const panel = el(`<div class="pmx-panel"><h3>Open TOPs by owner</h3>
    <div class="sub">Count of open TOP packages by days since delivery · property value at right</div>
    <div class="pmx-legend">${pmAgesFor(rows).map((a) => `<span><i class="pmx-dot" style="background:${a.color}"></i>${esc(a.label)}</span>`).join("")}</div></div>`);
  if (!rows.length) { panel.appendChild(el(`<div class="pmx-empty">No open TOPs in this view.</div>`)); return panel; }
  const by = {};
  for (const r of rows) (by[r.poc] = by[r.poc] || []).push(r);
  const names = Object.keys(by).sort((a, b) => by[b].length - by[a].length || pmSum(by[b], "value") - pmSum(by[a], "value"));
  const max = Math.max(...names.map((n) => by[n].length));
  const bars = el(`<div class="pmx-bars"></div>`);
  for (const n of names) {
    const segs = pmAgesFor(rows).map((a) => {
      const rs = by[n].filter((r) => r.bucket === a.id);
      if (!rs.length) return "";
      const tip = `<b>${esc(n)} — ${esc(a.label)}</b><br>${rs.map((r) => `${esc(r.num)} · ${esc(r.title)} · ${pmMoney(r.value)}`).join("<br>")}`;
      return `<div class="sg" style="width:${(rs.length / max * 100).toFixed(2)}%;background:${a.color}" data-tip="${esc(tip)}">${rs.length}</div>`;
    }).join("");
    bars.appendChild(el(`<div class="pmx-bar"><span class="nm" title="${esc(n)}">${esc(n)}</span><div class="tr">${segs}</div>
      <span class="tot"><b>${by[n].length}</b> · ${pmMoney(pmSum(by[n], "value"))}</span></div>`));
  }
  panel.appendChild(bars);
  return panel;
}

function pmActList(kind, rows, dateOf, dateLbl, emptyTxt) {
  if (!rows.length) return `<div class="none">${esc(emptyTxt)}</div>`;
  const today = pmToday();
  return `<ul>${rows.map((r) => {
    const d = dateOf(r);
    const late = d && pmDays(today, d) < 0;
    return `<li data-num="${esc(r.num)}"><span class="w">${esc(r.num)}</span><span class="t" title="${esc(r.title)}">${esc(pmShortName(r.poc))} · ${esc(r.title)}</span>
      <span class="d" style="color:${late ? "var(--ax-red)" : "inherit"}">${esc(dateLbl(r, d, late))}</span></li>`;
  }).join("")}</ul>`;
}
function pmPrActions(rows) {
  const today = pmToday();
  const est = rows.filter((r) => r.estDue && pmDays(today, r.estDue) <= PM_SOON_DAYS).sort((a, b) => a.estDue - b.estDue);
  const po = rows.filter((r) => r.poDue && pmDays(today, r.poDue) <= PM_SOON_DAYS).sort((a, b) => a.poDue - b.poDue);
  const ct = rows.filter((r) => /100k/i.test(r.status)).sort((a, b) => a.statusSince - b.statusSince);
  const lbl = (r, d, late) => d ? (late ? `${pmDays(d, today)}d overdue` : pmFmt(d)) : "";
  const panel = el(`<div class="pmx-panel pmx-act"><h3>Next ${PM_SOON_DAYS} days</h3><div class="sub">Click an item to open it in the table</div>
    <h4><span>Cost estimates due</span><span>${est.length}</span></h4>${pmActList("proc", est, (r) => r.estDue, lbl, "None due.")}
    <h4><span>POs expected</span><span>${po.length}</span></h4>${pmActList("proc", po, (r) => r.poDue, lbl, "None expected.")}
    ${ct.length ? `<h4><span>Waiting on CT Program &gt; $100K approval</span><span>${ct.length}</span></h4>${pmActList("proc", ct, (r) => null, (r) => `${pmDays(r.statusSince, today)}d · ${pmMoney(r.cost)}`, "")}` : ""}
  </div>`);
  panel.querySelectorAll("li[data-num]").forEach((li) => li.addEventListener("click", () => pmOpenRow("proc", li.getAttribute("data-num"))));
  return panel;
}
function pmTopActions(rows, D) {
  const ui = PmUi.prop;
  const tile = (key, label, rs, dot, red) => `<button type="button" class="pmx-age ${ui.quick === key ? "on" : ""}" data-key="${key}">
    <div class="k">${dot ? `<i class="pmx-dot" style="background:${dot}"></i>` : ""}${esc(label)}</div>
    <div class="v" style="${red && rs.length ? "color:var(--ax-red)" : ""}">${rs.length}</div><div class="s">${pmMoney(pmSum(rs, "value"))}</div></button>`;
  const by = (b) => rows.filter((r) => r.bucket === b);
  const oldest = rows.filter((r) => r.lane === "delivered").sort((a, b) => (b.age || 0) - (a.age || 0)).slice(0, 6);
  const noTop = D.noTop.slice().sort((a, b) => (a.podDate || a.closedDate) - (b.podDate || b.closedDate));
  const panel = el(`<div class="pmx-panel pmx-act"><h3>TOP backlog</h3><div class="sub">Delivered property whose TOP isn't closed, by days since delivery</div>
    <div class="pmx-ages">${tile("age:a15", "Within 15 days", by("a15"), "#3987e5")}${tile("age:a30", "16–30 days", by("a30"), "#1c5cab")}
      ${tile("age:a31", "More than 30 days", by("a31"), "#c62828", true)}${by("unk").length ? tile("age:unk", PM_AGE_UNK.label, by("unk"), PM_AGE_UNK.color) : ""}</div>
    <h4><span>Oldest open TOPs</span><span>${oldest.length}</span></h4>${pmActList("prop", oldest, () => null, (r) => `${r.age != null ? r.age + "d" : "date unknown"} · ${pmMoney(r.value)}`, "None.")}
    <h4><span title="Delivered or closed PRs with TOP Required = Yes and no PMCT naming them">TOP required — no PMCT yet</span><span>${noTop.length}</span></h4>
    ${noTop.length ? `<ul>${noTop.slice(0, 8).map((p) => `<li data-pr="${esc(p.num)}"><span class="w">PR ${esc(p.num)}</span><span class="t" title="${esc(p.title)}">${esc(pmShortName(p.poc))} · ${esc(p.title)}</span><span class="d">${esc(p.status)}</span></li>`).join("")}</ul>` : `<div class="none">Every delivered PR that needs a TOP has a PMCT.</div>`}
  </div>`);
  panel.querySelectorAll(".pmx-age").forEach((b) => b.addEventListener("click", () => { ui.quick = ui.quick === b.dataset.key ? "" : b.dataset.key; pmRerender(); }));
  panel.querySelectorAll("li[data-num]").forEach((li) => li.addEventListener("click", () => pmOpenRow("prop", li.getAttribute("data-num"))));
  panel.querySelectorAll("li[data-pr]").forEach((li) => li.addEventListener("click", () => pmGoto("proc", li.dataset.pr)));
  return panel;
}

/** Jump to a record on the other tab (PR <-> PMCT), in whichever view holds it. */
function pmGoto(kind, num) {
  AppState.activeTool = kind;
  const rec = (kind === "proc" ? pmData().prs : pmData().tops).find((x) => x.num === num);
  PmUi[kind].view = rec && rec.closed ? "closed" : "active";
  if (rec && rec.closed) PmUi[kind].period = "all";
  if (rec && rec.lane === "draft") PmUi[kind].drafts = true;
  pmOpenRow(kind, num, true);
}

/** Open a row in the table (clears filters that would hide it) and scroll to it. */
function pmOpenRow(kind, num, switched) {
  const ui = PmUi[kind];
  ui.quick = ""; ui.q = ""; ui.poc = ""; ui.attn = false;
  ui.open = new Set([num]);
  if (switched) { renderRail(); renderDashboard(); }
  renderWorkspace();
  requestAnimationFrame(() => {
    const row = document.querySelector(`.pmx-tbl tr.row[data-num="${num}"]`);
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

/* ---- table ---- */
function pmCols(kind, isActive) {
  if (kind === "proc") return isActive ? [
    { k: "num", l: "PR" }, { k: "title", l: "Title" }, { k: "poc", l: "Buyer" }, { k: "lane", l: "Step / ATLAS status" },
    { k: "cost", l: "Value", num: true }, { k: "statusSince", l: "In status" }, { k: "rdd", l: "RDD" }, { k: "next", l: "Next due" },
    { k: "latest", l: "Latest update" }, { k: "flags", l: "Attention" },
  ] : [
    { k: "num", l: "PR" }, { k: "title", l: "Title" }, { k: "poc", l: "Buyer" }, { k: "status", l: "Final status" },
    { k: "cost", l: "Total cost", num: true }, { k: "approved", l: "Approved", num: true }, { k: "poDate", l: "PO" }, { k: "podDate", l: "POD" },
    { k: "closedDate", l: "Closed" }, { k: "pmcts", l: "PMCT" },
  ];
  return isActive ? [
    { k: "num", l: "PMCT" }, { k: "title", l: "TOP / title" }, { k: "source", l: "From" }, { k: "poc", l: "Owner" }, { k: "country", l: "Country" },
    { k: "lane", l: "Step / ATLAS status" }, { k: "value", l: "Property value", num: true }, { k: "delivered", l: "Delivered" }, { k: "age", l: "Days open", num: true },
    { k: "latest", l: "Latest update" }, { k: "flags", l: "Attention" },
  ] : [
    { k: "num", l: "PMCT" }, { k: "title", l: "TOP / title" }, { k: "source", l: "From" }, { k: "poc", l: "Owner" }, { k: "country", l: "Country" },
    { k: "status", l: "Final status" }, { k: "value", l: "Property value", num: true }, { k: "delivered", l: "Delivered" }, { k: "closedDate", l: "Closed" },
  ];
}
function pmCell(kind, r, c, today) {
  const lanes = kind === "proc" ? PM_PR_LANES : PM_TOP_LANES;
  switch (c.k) {
    case "num": return `<td class="w">${esc(r.num)}</td>`;
    case "title": return `<td class="tt">${esc(r.title)}${r.program ? `<br><small>${esc(r.program)}${kind === "proc" && r.country ? " · " + esc(r.country) : ""}</small>` : ""}</td>`;
    case "lane": {
      const l = lanes.find((x) => x.id === r.lane);
      return `<td><div class="pmx-st"><i class="pmx-dot" style="background:${l.color}"></i>${esc(l.label)}</div><div class="pmx-st"><small>${esc(r.status)}</small></div></td>`;
    }
    case "cost": case "approved": return `<td class="num">${r[c.k] ? pmMoney(r[c.k], true) : "—"}</td>`;
    case "value": return `<td class="num">${r.value ? pmMoney(r.value, true) : "—"}${r.value >= PM_BIG_TOP ? `<br><span class="pmx-pill big">≥ $200K</span>` : ""}</td>`;
    case "statusSince": return `<td>${r.statusSince ? `${pmDays(r.statusSince, today)}d<br><small style="color:var(--ax-muted)">since ${pmFmt(r.statusSince)}</small>` : ""}</td>`;
    case "rdd": return `<td>${r.rdd ? pmFmt(r.rdd) : ""}</td>`;
    case "next": {
      const d = r.estDue || r.poDue;
      if (!d) return `<td></td>`;
      const late = pmDays(today, d) < 0;
      return `<td style="${late ? "color:var(--ax-red);font-weight:600" : ""}">${r.estDue ? "Estimate" : "PO"} ${pmFmt(d)}</td>`;
    }
    case "latest": return `<td class="note">${r.latest ? `<div class="clamp" title="${esc(r.latest.note || r.latest.stage)}"><b>${r.latest.date ? pmFmt(r.latest.date) : ""}</b> ${esc(r.latest.note || r.latest.stage)}</div>` : `<span style="color:var(--ax-muted)">—</span>`}</td>`;
    case "flags": return `<td>${r.flags.map((f) => `<span class="pmx-pill ${f.lvl}">${esc(f.text)}</span>`).join("") || `<span class="pmx-pill ok">On track</span>`}</td>`;
    case "age": return `<td class="num">${r.age != null ? r.age : ""}</td>`;
    case "pmcts": return `<td>${r.pmcts.map((t) => esc(t.num)).join(", ")}</td>`;
    default: { const v = r[c.k]; return `<td>${v instanceof Date ? pmFmt(v) : esc(v == null ? "" : v)}</td>`; }
  }
}
function pmTable(kind, rows, isActive) {
  const ui = PmUi[kind];
  const cols = pmCols(kind, isActive);
  const today = pmToday();
  if (!rows.length) return el(`<div class="pmx-empty">Nothing matches the filters.</div>`);
  const head = cols.map((c) => `<th data-k="${c.k}" class="${c.num ? "num" : ""}">${esc(c.l)}${ui.sort.k === c.k ? (ui.sort.d > 0 ? " ▲" : " ▼") : ""}</th>`).join("");
  const body = rows.map((r) => {
    const open = ui.open.has(r.num);
    return `<tr class="row ${open ? "open" : ""}" data-num="${esc(r.num)}">${cols.map((c) => pmCell(kind, r, c, today)).join("")}</tr>` +
      (open ? `<tr class="pmx-det"><td colspan="${cols.length}">${kind === "proc" ? pmPrDetail(r) : pmTopDetail(r)}</td></tr>` : "");
  }).join("");
  const wrap = el(`<div class="pmx-wrap"><table class="pmx-tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
  wrap.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k;
    ui.sort = ui.sort.k === k ? (ui.sort.d > 0 ? { k, d: -1 } : { k: "", d: 1 }) : { k, d: 1 };
    pmRerender();
  }));
  wrap.querySelectorAll("tr.row").forEach((tr) => tr.addEventListener("click", () => {
    const n = tr.dataset.num;
    if (ui.open.has(n)) ui.open.delete(n); else ui.open.add(n);
    pmRerender();
  }));
  wrap.querySelectorAll("[data-goto]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    const [k, n] = a.dataset.goto.split(":");
    pmGoto(k, n);
  }));
  return wrap;
}
function pmKv(pairs) {
  return `<div class="pmx-kv">${pairs.filter((p) => p[1]).map(([k, v]) => `<span>${esc(k)}</span><span>${v}</span>`).join("")}</div>`;
}
function pmNotesHtml(r) {
  const acts = r.acts.slice(0, 6);
  if (!acts.length) return `<div style="color:var(--ax-muted);font-size:12px">No Activity Tracker entries.</div>`;
  return `<ul class="pmx-notes">${acts.map((a) => `<li><b>${a.date ? pmFmt(a.date, true) : ""}</b> · <span style="color:var(--ax-muted)">${esc(a.stage)}</span><br>${esc(a.note)}</li>`).join("")}</ul>`;
}
function pmPrDetail(r) {
  const d = (x) => x ? esc(pmFmt(x, true)) : "";
  const links = r.pmcts.map((t) => `<a href="#" data-goto="prop:${esc(t.num)}">PMCT ${esc(t.num)}</a> (${esc(t.status)})`).join("<br>");
  return `<div class="pmx-dg">
    <div><h5>Request</h5>${pmKv([["WMTR", esc(r.wmtr)], ["Program", esc(r.program)], ["Destination", esc(r.country)], ["Buyer", esc(r.poc)], ["Alternate", esc(r.alt)],
      ["TOP required", r.topReq ? "Yes" : "No"], ["PMCT", links || (r.topReq ? '<span style="color:var(--ax-amber)">None yet</span>' : "")],
      ["Red flag", r.redFlag ? `<span style="color:var(--ax-red)">${esc(r.redFlagNote || "Yes")}</span>` : ""]])}</div>
    <div><h5>Milestones</h5>${pmKv([["Submitted", d(r.submitted)], ["Compliance approved", d(r.complianceApproved)], ["Estimate due", d(r.estDue)],
      ["Estimate submitted", d(r.estSubmitted)], ["CT > $100K approved", d(r.ct100k)], ["Estimate approved", r.estApproved ? `${d(r.estApproved)}${r.approved ? " · " + pmMoney(r.approved, true) : ""}` : ""],
      ["PO due", d(r.poDue)], ["PO issued", d(r.poDate)], ["POD", d(r.podDate)], ["RDD", d(r.rdd)], ["Closed", r.closed ? d(r.closedDate) : ""]])}</div>
    <div><h5>Recent updates</h5>${pmNotesHtml(r)}</div></div>`;
}
function pmTopDetail(r) {
  const d = (x) => x ? esc(pmFmt(x, true)) : "";
  const srcLinks = r.srcNums.map((n) => r.srcPr.indexOf(n) !== -1 ? `<a href="#" data-goto="proc:${esc(n)}">PR ${esc(n)}</a>` : (r.srfNums.indexOf(n) !== -1 ? `SRF ${esc(n)}` : esc(n))).join(", ");
  const att = r.att.slice(-6).reverse();
  return `<div class="pmx-dg">
    <div><h5>Transfer</h5>${pmKv([["WMTR", esc(r.wmtr)], ["Source request", srcLinks], ["Form", esc(r.form)], ["Owner", esc(r.poc)], ["Destination", esc(r.country)],
      ["Property value", r.value ? pmMoney(r.value, true) : '<span style="color:var(--ax-amber)">Not recorded</span>'], ["TOP comments", esc(r.topComments)],
      ["Red flag", r.redFlag ? `<span style="color:var(--ax-red)">${esc(r.redFlagNote || "Yes")}</span>` : ""]])}</div>
    <div><h5>Milestones & documents</h5>${pmKv([["Submitted", d(r.submitted)], ["Delivered", d(r.delivered)], ["Days open since delivery", r.age != null ? String(r.age) : ""],
      ["Transfer scheduled", d(r.xferScheduled)], ["Acknowledged by receiving party", d(r.xferAcked)], ["Transfer completed", d(r.xferDone)], ["Closed", r.closed ? d(r.closedDate) : ""]])}
      ${att.length ? `<ul class="pmx-notes" style="margin-top:8px">${att.map((a) => `<li><b>${esc(a.type || "Attachment")}</b>${a.note ? " · " + esc(a.note) : ""}<br><span style="color:var(--ax-muted)">${a.at ? pmFmt(a.at, true) : ""} ${esc(a.by)}</span></li>`).join("")}</ul>` : ""}</div>
    <div><h5>Recent updates</h5>${pmNotesHtml(r)}</div></div>`;
}

function pmExportXlsx(kind, rows, isActive) {
  const isPr = kind === "proc";
  const f = (d) => d instanceof Date ? xtIso(d) : "";
  const head = isPr
    ? ["WMTR", "Title", "Buyer", "Step", "ATLAS status", "Total cost", "Approved", "Status since", "RDD", "Estimate due", "PO due", "PO issued", "POD", "Closed",
       "TOP required", "PMCT", "Latest update date", "Latest update", "Attention"]
    : ["WMTR", "Title", "From", "Owner", "Country", "Step", "ATLAS status", "Property value", "Delivered", "Days open", "Transfer scheduled", "Acknowledged", "Transfer completed",
       "Closed", "Form", "Latest update date", "Latest update", "Attention"];
  const aoa = [head];
  for (const r of rows) {
    const att = r.flags.map((x) => x.text).join("; ");
    const lu = r.latest ? [f(r.latest.date), r.latest.note || r.latest.stage] : ["", ""];
    if (isPr) aoa.push([r.wmtr, r.title, r.poc, (PM_PR_LANES.find((l) => l.id === r.lane) || {}).label, r.status, r.cost || "", r.approved || "", f(r.statusSince), f(r.rdd),
      f(r.estDue), f(r.poDue), f(r.poDate), f(r.podDate), f(r.closedDate), r.topReq ? "Yes" : "No", r.pmcts.map((t) => t.num).join(", ")].concat(lu, [att]));
    else aoa.push([r.wmtr, r.title, r.source, r.poc, r.country, (PM_TOP_LANES.find((l) => l.id === r.lane) || {}).label, r.status, r.value || "", f(r.delivered),
      r.age == null ? "" : r.age, f(r.xferScheduled), f(r.xferAcked), f(r.xferDone), f(r.closedDate), r.form].concat(lu, [att]));
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = head.map((h) => ({ wch: /Title|Latest update$|Attention/.test(h) ? 48 : /WMTR/.test(h) ? 28 : 15 }));
  XLSX.utils.book_append_sheet(wb, ws, isPr ? (isActive ? "Active PRs" : "Closed PRs") : (isActive ? "Open TOPs" : "Closed TOPs"));
  pmrDownloadXlsxB64(XLSX.write(wb, { type: "base64", bookType: "xlsx" }), `${isPr ? "Procurement" : "Property"}_${isActive ? "Active" : "Closed"}_${fileStamp()}.xlsx`);
}

/* -------------------------------------------------------------------------
   WEEKLY QUAD SLIDE
   ------------------------------------------------------------------------- */
const PM_QUADS = [
  { id: "proc", name: "Procurement", hint: "e.g. Vendor delays, sole-source justifications, big buys coming" },
  { id: "prop", name: "Property", hint: "e.g. Property loss issues, endorsements chased this week" },
  { id: "pls", name: "Personnel Logistics Services", hint: "e.g. Cost estimates due within 5 days of PLS request" },
  { id: "prog", name: "Significant Program Actions", hint: "e.g. CDRLs due within the next 7 days" },
];
function pmSlideGet() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(PM_SLIDE_KEY) || "null"); } catch (e) { s = null; }
  s = s && typeof s === "object" ? s : {};
  return { title: s.title || "Program Management Weekly Update", sub: s.sub || "tRLS II", notes: Object.assign({ proc: "", prop: "", pls: "", prog: "" }, s.notes || {}) };
}
function pmSlideSet(s) { try { localStorage.setItem(PM_SLIDE_KEY, JSON.stringify(s)); } catch (e) { /* storage off */ } }
function pmBullets(txt) { return String(txt || "").split(/\r?\n/).map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean); }

/** Everything the slide shows, computed once (HTML preview + .pptx use the same numbers). */
/** Plain-English summary of a tab's filters ("" when none are set). */
function pmFilterDesc(kind) {
  const ui = PmUi[kind], isPr = kind === "proc", p = [];
  if (ui.poc) p.push(`${isPr ? "Buyer" : "Owner"} ${ui.poc}`);
  if (norm(ui.q)) p.push(`search "${norm(ui.q)}"`);
  if (ui.attn) p.push("needs attention");
  const k = ui.quick;
  if (k) {
    const lane = k.startsWith("lane:") && (isPr ? PM_PR_LANES : PM_TOP_LANES).find((l) => l.id === k.slice(5));
    const age = k.startsWith("age:") && PM_AGE.find((a) => a.id === k.slice(4));
    const names = { big: isPr ? "over $100K" : "$200K and over", attn: "needs attention", estdue: "estimates due", podue: "POs expected", rdd: "past RDD", flag: "red flags", nodate: "delivered – date unknown" };
    p.push(lane ? lane.label : age ? age.label : names[k] || k);
  }
  return p.join(", ");
}

function pmSlideModel(D) {
  const today = pmToday();
  const useF = PmUi.slideFiltered;
  const pool = (all, kind) => {
    const a = all.filter((r) => !r.closed);
    return useF ? pmFilter(a, Object.assign({}, PmUi[kind], { sort: { k: "", d: 1 } }), kind === "proc") : a;
  };
  const prPool = pool(D.prs, "proc");
  const prs = prPool.filter((r) => r.lane !== "draft");
  const tops = pool(D.tops, "prop").filter((r) => r.lane !== "draft");
  const pd = pmFilterDesc("proc"), td = pmFilterDesc("prop");
  const filterNote = useF && (pd || td) ? `Filtered: Procurement ${pd || "none"}; Property ${td || "none"}` : "";
  const buyers = {};
  for (const r of prs) (buyers[r.poc] = buyers[r.poc] || []).push(r);
  const bNames = Object.keys(buyers).sort((a, b) => buyers[b].length - buyers[a].length).slice(0, 7);
  const owners = {};
  for (const r of tops) (owners[r.poc] = owners[r.poc] || []).push(r);
  const oNames = Object.keys(owners).sort((a, b) => owners[b].length - owners[a].length).slice(0, 7);
  const prLanes = PM_PR_LANES.filter((l) => l.id !== "draft");
  const est = prs.filter((r) => r.estDue && pmDays(today, r.estDue) <= PM_SOON_DAYS).sort((a, b) => a.estDue - b.estDue);
  const po = prs.filter((r) => r.poDue && pmDays(today, r.poDue) <= PM_SOON_DAYS).sort((a, b) => a.poDue - b.poDue);
  const dueTxt = (r, d) => `${r.num} · ${pmShortName(r.poc)} · ${pmDays(today, d) < 0 ? `${pmDays(d, today)}d overdue` : pmFmt(d)}`;
  const bucket = (b) => tops.filter((r) => r.bucket === b);
  return {
    date: pmFmt(today, true), filterNote,
    pr: {
      n: prs.length, value: pmSum(prs, "cost"), drafts: prPool.filter((r) => r.lane === "draft").length,
      cats: bNames.map((n) => `${pmShortName(n)}  ${pmMoney(pmSum(buyers[n], "cost"))}`),
      series: prLanes.map((l) => ({ name: l.label, color: l.color, values: bNames.map((n) => buyers[n].filter((r) => r.lane === l.id).length) })),
      est: est.map((r) => dueTxt(r, r.estDue)), po: po.map((r) => dueTxt(r, r.poDue)),
    },
    top: {
      n: tops.length, value: pmSum(tops, "value"),
      cats: oNames.map((n) => `${pmShortName(n)}  ${pmMoney(pmSum(owners[n], "value"))}`),
      series: pmAgesFor(tops).map((a) => ({ name: a.label, color: a.color, values: oNames.map((n) => owners[n].filter((r) => r.bucket === a.id).length) })),
      tiles: [
        { label: "Within 15 days", rs: bucket("a15") }, { label: "16–30 days", rs: bucket("a30") },
        { label: "More than 30 days", rs: bucket("a31"), red: true },
      ].concat(bucket("unk").length ? [{ label: PM_AGE_UNK.label, rs: bucket("unk") }] : [])
        .map((t) => ({ label: t.label, n: t.rs.length, value: pmSum(t.rs, "value"), red: t.red })),
    },
  };
}

function pmSlideCard(D) {
  const S = pmSlideGet();
  const card = el(`<section class="copx-card">
    <div class="copx-hd"><h2>Weekly update slide</h2><span class="n">Procurement and Property fill from ATLAS · type notes for any quadrant below · one bullet per line</span>
      <div class="acts"><button class="copx-btn green" id="pmPptx" type="button">Download PowerPoint</button></div></div>
    <div class="copx-rule"></div>
    <label class="copx-chk" style="margin:0 0 10px"><input type="checkbox" id="pmSFilt" ${PmUi.slideFiltered ? "checked" : ""}> Use the dashboard filters
      <span style="color:var(--ax-muted)">(Procurement: ${esc(pmFilterDesc("proc") || "none")} · Property: ${esc(pmFilterDesc("prop") || "none")})</span></label>
    <div id="pmSlidePrev"></div>
    <div class="pmx-sedit">
      <div><label for="pmSTitle">Slide title</label><input id="pmSTitle" value="${esc(S.title)}"></div>
      <div><label for="pmSSub">Contract / subtitle</label><input id="pmSSub" value="${esc(S.sub)}"></div>
      ${PM_QUADS.map((q) => `<div><label for="pmN_${q.id}">${esc(q.name)} — notes</label><textarea id="pmN_${q.id}" placeholder="${esc(q.hint)}">${esc(S.notes[q.id])}</textarea>
        <div class="hint">${q.id === "proc" || q.id === "prop" ? "Shown under the automatic numbers." : "Fills this quadrant."} Saved in this browser.</div></div>`).join("")}
    </div>
    <div class="pmx-status" id="pmPptxStatus"></div>
  </section>`);
  const model = pmSlideModel(D);
  const prev = card.querySelector("#pmSlidePrev");
  const draw = () => { prev.innerHTML = pmSlideHtml(model, pmSlideGet()); };
  draw();
  const save = () => {
    const s = pmSlideGet();
    s.title = card.querySelector("#pmSTitle").value; s.sub = card.querySelector("#pmSSub").value;
    for (const q of PM_QUADS) s.notes[q.id] = card.querySelector(`#pmN_${q.id}`).value;
    pmSlideSet(s); draw();
  };
  card.querySelectorAll("input:not([type=checkbox]),textarea").forEach((n) => n.addEventListener("input", save));
  card.querySelector("#pmSFilt").addEventListener("change", (e) => { PmUi.slideFiltered = e.target.checked; pmRerender(); });
  card.querySelector("#pmPptx").addEventListener("click", async () => {
    const st = card.querySelector("#pmPptxStatus");
    st.className = "pmx-status"; st.textContent = "Building the PowerPoint…";
    try { const name = await pmBuildPptx(model, pmSlideGet()); st.textContent = `Downloaded ${name}`; }
    catch (e) { console.error(e); st.className = "pmx-status err"; st.textContent = e.message || String(e); }
  });
  return card;
}

function pmSlideBarsHtml(cats, series) {
  if (!cats.length) return `<div class="muted">None open.</div>`;
  const tot = cats.map((c, i) => series.reduce((s, x) => s + x.values[i], 0));
  const max = Math.max(1, ...tot);
  return `<div class="sb">${cats.map((c, i) => `<span>${esc(c)}</span><div class="tr">${series.map((s) => s.values[i]
    ? `<div class="sg" style="width:${(s.values[i] / max * 100).toFixed(1)}%;background:${s.color}">${s.values[i]}</div>` : "").join("")}</div>`).join("")}</div>
    <div class="lg">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>`;
}
function pmSlideList(head, items, cap) {
  const more = items.length > cap ? items.length - cap : 0;
  return `<div class="lh">${esc(head)} (${items.length})</div>` + (items.length
    ? `<ul>${items.slice(0, cap).map((t) => `<li>${esc(t)}</li>`).join("")}${more ? `<li>+${more} more</li>` : ""}</ul>` : `<div class="muted">None</div>`);
}
function pmSlideNotes(txt, empty) {
  const b = pmBullets(txt);
  return b.length ? `<ul>${b.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : (empty ? `<div class="muted">${esc(empty)}</div>` : "");
}
function pmSlideHtml(m, S) {
  return `<div class="pmx-slide">
    <div class="top"><h1>${esc(S.title)}</h1><span>${esc(S.sub)} · ${esc(m.date)}</span></div>
    <div class="quads">
      <div class="q"><div class="qh"><b>Procurement</b><span>${m.pr.n} open PRs · ${pmMoney(m.pr.value)}</span></div>
        <div class="qb"><div><div class="ct">Open PRs by buyer</div>${pmSlideBarsHtml(m.pr.cats, m.pr.series)}</div>
        <div>${pmSlideList(`Cost estimates due ≤ ${PM_SOON_DAYS} days`, m.pr.est, 3)}${pmSlideList(`POs expected ≤ ${PM_SOON_DAYS} days`, m.pr.po, 3)}${pmSlideNotes(S.notes.proc)}</div></div></div>
      <div class="q"><div class="qh"><b>Property</b><span>${m.top.n} open TOPs · ${pmMoney(m.top.value)}</span></div>
        <div class="qb"><div><div class="ct">Open TOPs by owner</div>${pmSlideBarsHtml(m.top.cats, m.top.series)}</div>
        <div><div class="lh">TOP backlog</div><div class="tiles">${m.top.tiles.map((t) => `<div class="tile"><b class="${t.red && t.n ? "r" : ""}">${t.n}<span style="font-size:.95cqw;font-weight:400;color:#5a6778">&nbsp;&nbsp;${pmMoney(t.value)}</span></b>${esc(t.label)}</div>`).join("")}</div>
          ${pmSlideNotes(S.notes.prop)}</div></div></div>
      <div class="q"><div class="qh"><b>Personnel Logistics Services</b></div><div class="qb one"><div>${pmSlideNotes(S.notes.pls, "Nothing to report this week.")}</div></div></div>
      <div class="q"><div class="qh"><b>Significant Program Actions</b></div><div class="qb one"><div>${pmSlideNotes(S.notes.prog, "Nothing to report this week.")}</div></div></div>
    </div>
    <div class="foot">Source: ATLAS PR and PMCT UDQs · drafts excluded${m.filterNote ? " · " + esc(m.filterNote) : ""}</div></div>`;
}

/* ---- PowerPoint (pptxgenjs, loaded on demand) ---- */
function pmLoadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error(`Couldn't load ${src}`));
    document.head.appendChild(s);
  });
}
async function pmPptxLib() {
  if (window.PptxGenJS) return window.PptxGenJS;
  if (!window.JSZip) throw new Error("The ZIP library didn't load — reload the page and try again.");
  for (const src of PM_PPTX_SRC) {
    try { await pmLoadScript(src); } catch (e) { /* try the next source */ }
    if (window.PptxGenJS) return window.PptxGenJS;
  }
  throw new Error("Couldn't load the PowerPoint library (cdn.jsdelivr.net). Check the internet connection and try again.");
}

async function pmBuildPptx(m, S) {
  const Lib = await pmPptxLib();
  const pptx = new Lib();
  pptx.layout = "LAYOUT_WIDE";                                      // 13.33 x 7.5 in
  pptx.author = "ATLAS Utility"; pptx.title = S.title;
  pptx.theme = { headFontFace: "Calibri", bodyFontFace: "Calibri" };
  const NAVY = "1E2A4A", INK = "1F2D3D", MUTED = "5A6778", CARD = "F4F6FA", LINE = "E1E6EE", RED = "C62828";
  const hex = (c) => c.replace("#", "").toUpperCase();
  const s = pptx.addSlide();
  s.background = { color: "FFFFFF" };
  s.addText(S.title, { x: 0.5, y: 0.28, w: 8.6, h: 0.6, fontSize: 26, bold: true, color: NAVY, margin: 0, isTextBox: true });
  s.addText(`${S.sub} · ${m.date}`, { x: 8.9, y: 0.36, w: 3.93, h: 0.5, fontSize: 13, color: MUTED, align: "right", margin: 0, isTextBox: true });

  // Top row (charts) gets more height than the bottom row (notes only).
  const gap = 0.3, X0 = 0.5, Y0 = 1.05, W = (12.333 - gap) / 2, HT = 3.1, HB = 6.85 - Y0 - gap - HT;
  const quads = [[X0, Y0, HT], [X0 + W + gap, Y0, HT], [X0, Y0 + HT + gap, HB], [X0 + W + gap, Y0 + HT + gap, HB]];
  const frame = (i, name, headline) => {
    const [x, y, H] = quads[i];
    s.addShape(pptx.ShapeType.roundRect, { x, y, w: W, h: H, fill: { color: CARD }, line: { color: LINE, width: 0.75 }, rectRadius: 0.08, objectName: `${name} card` });
    s.addText(name, { x: x + 0.22, y: y + 0.14, w: W * 0.6, h: 0.36, fontSize: 15, bold: true, color: NAVY, margin: 0, isTextBox: true });
    if (headline) s.addText(headline, { x: x + W * 0.45, y: y + 0.16, w: W * 0.55 - 0.22, h: 0.32, fontSize: 11, color: MUTED, align: "right", margin: 0, isTextBox: true });
    return { x: x + 0.22, y: y + 0.58, w: W - 0.44, h: H - 0.72 };
  };
  const bulletRuns = (groups) => {
    const runs = [];
    for (const g of groups) {
      if (g.head) runs.push({ text: g.head, options: { bold: true, color: NAVY, breakLine: true } });
      const items = g.items.length > g.cap ? g.items.slice(0, g.cap).concat([`+${g.items.length - g.cap} more`]) : g.items;
      if (!items.length && g.empty) runs.push({ text: g.empty, options: { italic: true, color: "8A94A3", breakLine: true } });
      for (const t of items) runs.push({ text: t, options: { bullet: { indent: 12 }, breakLine: true } });
    }
    if (runs.length) delete runs[runs.length - 1].options.breakLine;
    return runs;
  };
  const chart = (box, title, cats, series) => {
    if (!cats.length) { s.addText("None open.", { x: box.x, y: box.y, w: box.w, h: 0.3, fontSize: 11, italic: true, color: MUTED, margin: 0, isTextBox: true }); return; }
    const used = series.filter((x) => x.values.some((v) => v));
    s.addChart(pptx.ChartType.bar, used.map((x) => ({ name: x.name, labels: cats, values: x.values })), {
      x: box.x - 0.1, y: box.y - 0.08, w: box.w + 0.1, h: box.h + 0.08,
      barDir: "bar", barGrouping: "stacked", barGapWidthPct: 45, chartColors: used.map((x) => hex(x.color)),
      showTitle: true, title, titleFontSize: 10, titleColor: INK, titleFontFace: "Calibri",
      catAxisOrientation: "maxMin", catAxisLabelFontSize: 9, catAxisLabelColor: INK, catAxisLabelFontFace: "Calibri", catAxisLineShow: false,
      valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" },
      showValue: true, dataLabelPosition: "ctr", dataLabelFontSize: 8, dataLabelColor: "FFFFFF", dataLabelFormatCode: "#;;", dataLabelFontFace: "Calibri",
      showLegend: true, legendPos: "b", legendFontSize: 8, legendColor: MUTED, legendFontFace: "Calibri",
    });
  };
  const textOpts = (b, size) => ({ x: b.x, y: b.y, w: b.w, h: b.h, fontSize: size || 11, color: INK, valign: "top", margin: 0, paraSpaceAfter: 2, isTextBox: true });
  /* PowerPoint doesn't shrink text until it's edited, so size it here: estimate the wrapped
     lines (Calibri ≈ 0.47 em per character), step the font down to minFs, then trim the
     last list (Jon's notes) to "+N more" until it fits the box. */
  const fitText = (groups, b, maxFs, minFs) => {
    const need = (fs) => {
      const cpl = Math.max(8, Math.floor((b.w - 0.17) * 72 / (0.47 * fs)));
      let lines = 0, paras = 0;
      for (const g of groups) {
        const items = g.items.length > g.cap ? g.items.slice(0, g.cap).concat(["+N more"]) : g.items;
        const all = (g.head ? [g.head] : []).concat(items.length ? items : (g.empty ? [g.empty] : []));
        for (const t of all) { lines += Math.max(1, Math.ceil(String(t).length / cpl)); paras++; }
      }
      return lines * fs * 1.2 / 72 + paras * 2 / 72;
    };
    for (;;) {
      for (let fs = maxFs; fs >= minFs; fs -= 0.5) if (need(fs) <= b.h) return fs;
      const g = groups.slice().reverse().find((x) => x.items.length && Math.min(x.cap, x.items.length) > 1);
      if (!g) return minFs;
      g.cap = Math.min(g.cap, g.items.length) - 1;
    }
  };
  const addList = (groups, b, maxFs, minFs) => {
    const fs = fitText(groups, b, maxFs, minFs);
    s.addText(bulletRuns(groups), textOpts(b, fs));
  };

  // 1 · Procurement
  let b = frame(0, "Procurement", `${m.pr.n} open PRs · ${pmMoney(m.pr.value)}${m.pr.drafts ? ` (+${m.pr.drafts} drafts)` : ""}`);
  const lw = b.w * 0.54;
  chart({ x: b.x, y: b.y, w: lw, h: b.h }, "Open PRs by buyer (count by step)", m.pr.cats, m.pr.series);
  addList([
    { head: `Cost estimates due ≤ ${PM_SOON_DAYS} days (${m.pr.est.length})`, items: m.pr.est, cap: 3, empty: "None" },
    { head: `POs expected ≤ ${PM_SOON_DAYS} days (${m.pr.po.length})`, items: m.pr.po, cap: 3, empty: "None" },
    { head: pmBullets(S.notes.proc).length ? "Notes" : "", items: pmBullets(S.notes.proc), cap: 6 },
  ], { x: b.x + lw + 0.2, y: b.y, w: b.w - lw - 0.2, h: b.h }, 10.5, 8.5);

  // 2 · Property
  b = frame(1, "Property", `${m.top.n} open TOPs · ${pmMoney(m.top.value)}`);
  const pw = b.w * 0.5;
  chart({ x: b.x, y: b.y, w: pw, h: b.h }, "Open TOPs by owner", m.top.cats, m.top.series);
  const rx = b.x + pw + 0.2, rw = b.w - pw - 0.2, tw = (rw - 0.12) / 2, th = 0.56;
  s.addText("TOP backlog", { x: rx, y: b.y, w: rw, h: 0.26, fontSize: 10.5, bold: true, color: NAVY, margin: 0, isTextBox: true });
  m.top.tiles.forEach((t, i) => {
    const tx = rx + (i % 2) * (tw + 0.12), ty = b.y + 0.3 + Math.floor(i / 2) * (th + 0.1);
    s.addShape(pptx.ShapeType.roundRect, { x: tx, y: ty, w: tw, h: th, fill: { color: "FFFFFF" }, line: { color: LINE, width: 0.5 }, rectRadius: 0.06 });
    s.addText([
      { text: String(t.n), options: { fontSize: 16, bold: true, color: t.red && t.n ? RED : INK } },
      { text: `   ${pmMoney(t.value)}`, options: { fontSize: 10, color: MUTED, breakLine: true } },
      { text: t.label, options: { fontSize: 8.5, color: MUTED } },
    ], { x: tx + 0.1, y: ty + 0.03, w: tw - 0.14, h: th - 0.06, margin: 0, valign: "middle", isTextBox: true });
  });
  const notesY = b.y + 0.3 + Math.ceil(m.top.tiles.length / 2) * (th + 0.1) + 0.06;
  const pn = pmBullets(S.notes.prop);
  if (pn.length) addList([{ items: pn, cap: 6 }], { x: rx, y: notesY, w: rw, h: b.y + b.h - notesY }, 10.5, 8.5);

  // 3 · PLS, 4 · Significant Program Actions — Jon's notes
  b = frame(2, "Personnel Logistics Services", "");
  addList([{ items: pmBullets(S.notes.pls), cap: 12, empty: "Nothing to report this week." }], b, 12, 9);
  b = frame(3, "Significant Program Actions", "");
  addList([{ items: pmBullets(S.notes.prog), cap: 12, empty: "Nothing to report this week." }], b, 12, 9);

  s.addText(`Source: ATLAS PR and PMCT UDQs · drafts excluded${m.filterNote ? " · " + m.filterNote : ""} · generated ${new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`,
    { x: 0.5, y: 7.05, w: 12.33, h: 0.25, fontSize: 8, color: "8A94A3", margin: 0, isTextBox: true });

  const name = `PM_Weekly_Update_${fileStamp()}.pptx`;
  await pptx.writeFile({ fileName: name });
  return name;
}

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { pmPrLane, pmTopLane, pmIsClosed, pmMoney, pmParsePr, pmParsePmct };
}
