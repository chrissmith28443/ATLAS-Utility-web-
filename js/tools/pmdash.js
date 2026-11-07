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

const PM_TOOLS = ["proc", "prop", "pls"];
const PM_PLS_SOON_DAYS = 14;       // slide: "Trips starting ≤ 14 days" list

/* View settings — which tiles (t:), panels (p:) and table columns (c:) show on each tab.
   PM_VIEW_OFF = hidden in the recommended view (anything on Jon's slide stays on).
   The user's changes are saved per browser (atlas.pmdash.view) as { kind: { id: true|false } }. */
const PM_VIEW_KEY = "atlas.pmdash.view";
const PM_VIEW_OFF = {
  proc: ["t:rdd"],
  prop: ["t:flag"],
  pls: ["t:ended", "p:actions"],          // p:actions = the "Trip ended, still In Progress" list
};
const PM_VIEW_ITEMS = {
  proc: { tiles: [["open", "Open PRs"], ["est", `Estimates due ≤ ${PM_SOON_DAYS} days`], ["po", `POs expected ≤ ${PM_SOON_DAYS} days`], ["rdd", "Past RDD"], ["big", "Over $100K"], ["attn", "Need attention"]],
    panels: [["lanes", "Step lanes"], ["chart", "Open PRs by buyer (chart)"], ["actions", `Next ${PM_SOON_DAYS} days (list)`]] },
  prop: { tiles: [["open", "Open TOPs"], ["out", "Out for signature"], ["o30", "Out > 30 days"], ["big", "$200K and over"], ["flag", "Red flags"], ["attn", "Need attention"]],
    panels: [["lanes", "Step lanes"], ["chart", "Open TOPs by owner (chart)"], ["actions", "TOP backlog (list)"]] },
  pls: { tiles: [["open", "Open PLS"], ["trips", "Upcoming trips (next 30 / 60 / 90 days)"], ["now", "Traveling now"], ["dtra", "Estimate with DTRA"], ["ended", "Trip ended, still In Progress"], ["attn", "Need attention"]],
    panels: [["lanes", "Step lanes"], ["chart", "Upcoming trips (timeline)"], ["actions", "Trips to close out (list)"]] },
};
const PM_VIEW_LOCKED = ["num", "title"];   // table columns that always show
function pmViewGet() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(PM_VIEW_KEY) || "null"); } catch (e) { v = null; }
  return v && typeof v === "object" ? v : {};
}
function pmShow(kind, id) {
  const o = (pmViewGet()[kind] || {})[id];
  return typeof o === "boolean" ? o : (PM_VIEW_OFF[kind] || []).indexOf(id) === -1;
}
function pmViewSet(kind, id, on) {
  const v = pmViewGet(), k = v[kind] = v[kind] || {};
  const def = (PM_VIEW_OFF[kind] || []).indexOf(id) === -1;
  if (on === def) delete k[id]; else k[id] = on;
  try { localStorage.setItem(PM_VIEW_KEY, JSON.stringify(v)); } catch (e) { /* storage off */ }
}
function pmViewReset(kind) {
  const v = pmViewGet(); delete v[kind];
  try { localStorage.setItem(PM_VIEW_KEY, JSON.stringify(v)); } catch (e) { /* storage off */ }
}
function pmViewChanged(kind) { return Object.keys(pmViewGet()[kind] || {}).length > 0; }
/* View settings button: a sliders icon; the small dot means this tab's view differs from the recommended one. */
const PM_VIEW_BTN = (kind) => {
  const custom = pmViewChanged(kind);
  const tip = `View settings — choose which tiles, panels and columns show${custom ? " (customized)" : ""}`;
  return `<button class="copx-btn ghost pmx-icon pmx-viewbtn ${PmUi.viewEdit === kind ? "on" : ""}" type="button" id="pmViewBtn" aria-expanded="${PmUi.viewEdit === kind}" title="${esc(tip)}" aria-label="${esc(tip)}">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>${custom ? `<i class="pmx-vdot" aria-hidden="true"></i>` : ""}</button>`;
};
function pmIsTool(id) { return PM_TOOLS.indexOf(id) !== -1; }

/* Lanes (pipeline steps). Colours = one blue ramp (ordinal), drafts neutral. */
const PM_PR_LANES = [
  { id: "draft",    label: "Draft",                 color: "#aab4c3" },
  { id: "review",   label: "TTI / DTRA review",     color: "#5598e7" },
  { id: "estimate", label: "Estimate / Approval",   color: "#2a78d6" },
  { id: "sourcing", label: "Sourcing (PO pending)", color: "#184f95" },
  { id: "exec",     label: "PO issued / delivery",  color: "#1e2a4a" },
];
/* PMCTs skip DTRA review (they go straight to DTRA Approved) — they hold the TOP package.
   Two open steps, from Activity Tracker entries: TOP being prepared -> out for government signature. */
const PM_TOP_LANES = [
  { id: "draft",     label: "Draft",                     color: "#aab4c3" },
  { id: "approved",  label: "TOP being prepared",        color: "#2a78d6" },
  { id: "delivered", label: "Out for signature",         color: "#1e2a4a" },
];
const PM_TOP_SENT_RE = /top submitted for signature/i;     // Activity "PMCT – TOP submitted for signature"
const PM_TOP_BACK_RE = /signed top returned/i;            // Activity "PMCT – Signed TOP returned to TTI"
/* TOP backlog buckets — days out for signature (Jon's slide). */
const PM_AGE = [
  { id: "pre", label: "Not yet sent", color: "#8c97a8" },
  { id: "a15", label: "Within 15 days",    color: "#3987e5" },
  { id: "a30", label: "16–30 days",        color: "#1c5cab" },
  { id: "a31", label: "Over 30 days",      color: "#c62828" },
  { id: "unk", label: "Sent – date unknown", color: "#d08a00" },   // Delivered status but no "TOP submitted for signature" entry
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
function pmTopLane(status, sigSent) {
  const s = norm(status).toLowerCase();
  if (/^draft/.test(s)) return "draft";
  if (sigSent || /^delivered/.test(s)) return "delivered";        // Delivered status = sent for signature
  return "approved";
}
/* PLS (Personnel Logistics Services) steps — same blue ramp. */
const PM_PLS_LANES = [
  { id: "draft",    label: "Draft",                  color: "#aab4c3" },
  { id: "review",   label: "DTRA program review",    color: "#5598e7" },
  { id: "estimate", label: "TTI estimate prep",      color: "#2a78d6" },
  { id: "approval", label: "Estimate with DTRA",     color: "#184f95" },
  { id: "booked",   label: "Approved / in progress", color: "#1e2a4a" },
];
function pmPlsLane(status) {
  const s = norm(status).toLowerCase();
  if (/^draft/.test(s)) return "draft";
  if (/^tti estimate/.test(s)) return "estimate";
  if (/estimate review|fulfillment/.test(s)) return "approval";
  if (/in progress/.test(s)) return "booked";
  return "review";
}
function pmLanesFor(kind) { return kind === "proc" ? PM_PR_LANES : kind === "pls" ? PM_PLS_LANES : PM_TOP_LANES; }
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

function pmBlocks(grid, idRe) {
  const re = idRe || /^WMTR-/i;                                   // PLS records start "PLS-"
  const max = gridMaxRow(grid);
  const starts = [];
  for (let r = 2; r <= max; r++) if (re.test(norm(gridCell(grid, r, 1)))) starts.push(r);
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
  // Linked Request List: B Request Type · C Request Number · D Linkage Type · F Status.
  const links = pmSection(grid, rr, rEnd, /^linked request list$/i).rows
    .map((r) => ({ type: norm(r[0]).toUpperCase(), num: pmNum(r[1]), ltype: norm(r[2]), status: norm(r[4]) }))
    .filter((l) => l.num);
  return {
    svc, wmtr, num: pmNum(wmtr), status, closed: pmIsClosed(status),
    title: norm(S("Request Title")), poc: norm(S("TTI POC Name")) || "Unassigned",
    alt: norm(S("TTI Alternate POC Name")),
    country: pmCountry(S("CTR Country")),
    program: norm(S("CTR Program")),
    ref: norm(S("Requestor Ref.#")),
    redFlag: /^true$/i.test(norm(S("Red Flag"))), redFlagNote: norm(S("Red Flag Comments")),
    topReq: /^(yes|true)$/i.test(norm(S("Transfer of Property (TOP) Required?"))),
    topComments: norm(S("TOP Comments")),
    rdd: xtParseDate(S("NLT Completion Date")),
    submitted, statusSince, wfl, att, acts, latest, links,
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
    // PO issued comes ONLY from Activity Tracker "PR – PO Issued" entries (one per PO; a PR can need several).
    const poActs = b.acts.filter((a) => a.date && /po issued/i.test(a.stage)).map((a) => a.date).sort((x, y) => x - y);
    const r = Object.assign(b, {
      lane: pmPrLane(b.status),
      cost: toFloat(b.S("Total Cost in USD")) || 0,
      approved: approvedCosts.length ? approvedCosts[0].cost : null,
      complianceApproved: newest("DTRA Compliance Review (Approved)"),
      estSubmitted: oldest("DTRA Estimate Review"),
      estApproved: newest("DTRA Estimate Review (Approved)"),
      ct100k: newest("CT Program > 100K Approval (Approved)"),
      poDate: poActs[0] || null,
      poCount: poActs.length,
      // Past sourcing (Production or Delivery now, or ever on a finished PR) = should have a PO Issued entry.
      poExpected: pmPrLane(b.status) === "exec" || (b.closed && !/^cancel/i.test(b.status) && !!oldest("Production or Delivery")),
      // Delivered = the PR's Delivery Date field only (a PR can have many PODs, one per PO — those aren't used).
      delivDate: xtParseDate(b.S("Delivery Date")) || null,
    });
    // Estimate due = 3 business days after compliance approval (Christmas Tree PR rule);
    // re-estimates count from when the request came back to TTI.
    if (/^tti estimate preparation$/i.test(r.status)) {
      const base = [r.complianceApproved, r.statusSince].filter(Boolean).sort((x, y) => y - x)[0];
      r.estDue = base ? xtWorkday(base, 3, true) : null;
    }
    // PO due = 1 business day (weekends + holidays skipped) after the estimate is approved. Applies for as long
    // as the PR sits in Sourcing — a PR with several POs stays here until all are issued.
    if (r.lane === "sourcing") {
      const base = r.estApproved || r.statusSince;
      r.poDue = base ? xtWorkday(base, 1, true) : null;
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
    // The two TOP dates come ONLY from Activity Tracker entries (status dates can't be relied on):
    // sent to the government for signature, and signed TOP received back.
    const sigSent = pmActDate(b.acts, PM_TOP_SENT_RE), sigBack = pmActDate(b.acts, PM_TOP_BACK_RE);
    const r = Object.assign(b, {
      lane: pmTopLane(b.status, sigSent),
      value: value || 0,
      sigSent, sigBack, sigDays: sigSent && sigBack ? pmDays(sigSent, sigBack) : null,
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
  if (r.poExpected && !r.poCount) f.push({ lvl: "amber", key: "nopo", fix: true, text: "No \"PO Issued\" entry in the Activity Tracker" });
  if (r.rdd && !r.delivDate && r.lane !== "draft") {
    const d = pmDays(today, r.rdd);
    if (d < 0) f.push({ lvl: "red", key: "rdd", text: `Past RDD (${pmFmt(r.rdd)})` });
    else if (d <= PM_RDD_SOON_DAYS) f.push({ lvl: "amber", key: "rdd", text: d === 0 ? "RDD today" : `RDD in ${pmPlural(d, "day")}` });
  }
  if (r.lane !== "draft") {
    if (!r.lastUpdate) f.push({ lvl: "amber", key: "stale", text: "No Activity Tracker updates" });
    else if (pmDays(r.lastUpdate, today) > PM_STALE_DAYS) f.push({ lvl: "amber", key: "stale", text: `No update in ${pmDays(r.lastUpdate, today)} days` });
  }
  // Every PR with TOP Required = Yes needs a PMCT in the Linked Request List (any status but Draft / Cancelled).
  if (r.topReq && r.lane !== "draft" && !/^cancel/i.test(r.status) && !r.pmcts.length)
    f.push({ lvl: "amber", key: "notop", fix: true, text: "TOP required — no PMCT linked" });
  return f;
}
function pmTopFlags(r, today) {
  const f = [];
  if (r.redFlag) f.push({ lvl: "red", key: "flag", text: `Red flag${r.redFlagNote ? ": " + r.redFlagNote : ""}` });
  const cancelled = /^cancel/i.test(r.status);
  if (!r.sigSent && !cancelled && (r.lane === "delivered" || r.closed))
    f.push({ lvl: "amber", key: "nosent", fix: true, text: "No \"TOP submitted for signature\" Activity entry" });
  if (r.closed && !cancelled && !r.sigBack)
    f.push({ lvl: "amber", key: "noback", fix: true, text: "No \"Signed TOP returned to TTI\" Activity entry" });
  if (!r.closed && r.sigBack)
    f.push({ lvl: "amber", key: "signed", text: `Signed TOP back ${pmFmt(r.sigBack)} — PMCT not Completed` });
  if (r.lane === "delivered") {
    if (!r.sigBack && r.age > 30) f.push({ lvl: "red", key: "a31", text: `Out for signature ${r.age} days` });
    else if (!r.sigBack && r.age > 15) f.push({ lvl: "amber", key: "a30", text: `Out for signature ${r.age} days` });
    if (!r.value) f.push({ lvl: "amber", key: "novalue", text: "No property value recorded" });
  }
  // A TOP package comes from a PR (TTI procurement) or an SRF (DTRA-owned equipment) — it must be linked to one.
  if (r.lane !== "draft" && !cancelled && !r.srcLinks.length) f.push({ lvl: "amber", key: "nolink", fix: true, text: "No linked PR or SRF" });
  // No Activity Tracker "stale" check: PMCTs don't need periodic updates.
  return f;
}

/* ---- PLS ----
   A PLS record carries titled col-B lists (Participants, Itinerary, one list per vendor service
   — Lodging, Ground Transportation, TTI-procured Ticket, … — Workflow Logs, Linked Request List). */
const PM_PLS_TITLE = /(\blist|\blogs|ticket)$|^(other services|additional requestors|ground transportation)/i;
const PM_PLS_HDR = /^(name|line item id|status|start date|request type)$/i;
function pmPlsSections(grid, rr, rEnd) {
  const take = (r) => { const v = []; for (let c = 2; c <= 16; c++) v.push(normWs(gridCell(grid, r, c))); return v; };
  const out = [];
  let cur = null;
  for (let r = rr + 1; r < rEnd; r++) {
    const v = take(r);
    if (!v.some(Boolean)) continue;
    const title = v[0] && !v.slice(1).some(Boolean) && !/^\d+$/.test(v[0]) &&
      (PM_PLS_TITLE.test(v[0]) || PM_PLS_HDR.test(normWs(gridCell(grid, r + 1, 2))));
    if (title) { cur = { title: v[0], hdr: take(r + 1), rows: [] }; out.push(cur); r++; continue; }
    if (cur) cur.rows.push(v);
  }
  return out;
}
function pmParsePls(grid) {
  // Header lookup that ignores spacing / punctuation ("Team/Event Name" = "Team Event Name") — for the ATLAS JSON pull.
  const H0 = buildHeaderMap(grid, 1), loose = {};
  const squash = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const k of Object.keys(H0)) if (!(squash(k) in loose)) loose[squash(k)] = H0[k];
  const H = new Proxy(H0, { get: (t, k) => (t[k] != null ? t[k] : loose[squash(k)]) });
  const out = [];
  const eq = (a, n) => norm(a).toLowerCase() === n.toLowerCase();
  for (const { rr, rEnd } of pmBlocks(grid, /^PLS-/i)) {
    const b = pmBase(grid, H, rr, rEnd, "PLS");
    const S = b.S;
    b.wfl = b.wfl.filter((e) => e.dt);                               // lists after the log aren't log rows
    const secs = pmPlsSections(grid, rr, rEnd);
    const part = secs.find((x) => /^participants/i.test(x.title));
    const ni = part ? part.hdr.findIndex((h) => /^number of participants$/i.test(h)) : -1;
    const newest = (n) => { const e = b.wfl.find((x) => eq(x.status, n)); return e ? e.dt : null; };
    const approvedCosts = b.wfl.filter((x) => eq(x.status, "DTRA Estimate Review (Approved)") && x.cost);
    const country = pmCountry(S("Destination Country")), city = norm(S("Destination City"));
    const r = Object.assign(b, {
      lane: pmPlsLane(b.status),
      title: norm(S("Team/Event Name")),
      program: norm(S("CT Funding Program")),
      country, city, dest: city ? `${country}, ${city}` : country,
      start: xtParseDate(S("Start Date")), end: xtParseDate(S("End Date")),
      cost: toFloat(S("Total Cost in USD")) || 0,
      approved: approvedCosts.length ? approvedCosts[0].cost : null,
      dtr: norm(S("Associated DTR/IR Number")), travelType: norm(S("Type Of Travel")), purpose: norm(S("Purpose of Travel/Request Summary")),
      requestor: norm(S("CT Requestor Name")), ctpm: norm(S("CT Project Manager Name")), clin: norm(S("Contract CLIN")),
      travelers: part ? part.rows.filter((x) => x[0]).reduce((s, x) => s + Math.max(1, ni >= 0 ? toFloat(x[ni]) || 0 : 0), 0) : 0,
      // one per line item (rows with a Line Item Id — the export nests traveler sub-rows under each)
      services: secs.filter((x) => /^line item id$/i.test(x.hdr[0]) && x.rows.some((y) => y[0])).map((x) => ({ name: x.title.replace(/\s+list$/i, ""), n: x.rows.filter((y) => y[0]).length })),
      programApproved: newest("DTRA Program Review (Approved)"),
      estApproved: newest("DTRA Estimate Review (Approved)"),
    });
    // PLS estimates aren't tracked (no due dates / turnaround) for now — user, 2026-11-07.
    delete r.S;
    out.push(r);
  }
  return out;
}
function pmPlsFlags(r, today) {
  const f = [];
  if (r.redFlag) f.push({ lvl: "red", key: "flag", text: `Red flag${r.redFlagNote ? ": " + r.redFlagNote : ""}` });
  if (r.closed || r.lane === "draft") return f;
  if (r.lane === "booked" && r.end && pmDays(r.end, today) > 0) f.push({ lvl: "amber", key: "ended", text: `Trip ended ${pmFmt(r.end)} — still In Progress` });
  if (!r.start || !r.end) f.push({ lvl: "amber", key: "nodates", fix: true, text: "No Start / End Date" });
  if (r.lane === "booked" && !r.cost) f.push({ lvl: "amber", key: "nocost", fix: true, text: "Approved, but no Total Cost" });
  if (r.poc === "Unassigned") f.push({ lvl: "amber", key: "nopoc", fix: true, text: "No TTI POC" });
  return f;
}

/** Everything both tabs need, rebuilt only when a slot changes. */
let _pmCache = null;
function pmData() {
  const prSlot = XTree.slots.PR, pmSlot = XTree.slots.PMCT, plsSlot = PmPls.slot;
  const key = new Date().toDateString();
  if (_pmCache && _pmCache.pr === prSlot && _pmCache.pm === pmSlot && _pmCache.pls === plsSlot && _pmCache.key === key) return _pmCache.data;
  const today = pmToday();
  const prs = prSlot && prSlot.grid ? pmParsePr(prSlot.grid) : [];
  const tops = pmSlot && pmSlot.grid ? pmParsePmct(pmSlot.grid) : [];
  const pls = plsSlot && plsSlot.grid ? pmParsePls(plsSlot.grid) : [];
  for (const r of pls) {
    r.phase = !r.start ? "" : pmDays(today, r.start) > 0 ? "upcoming" : (!r.end || pmDays(r.end, today) <= 0) ? "now" : "ended";
    r.flags = pmPlsFlags(r, today);
  }
  // PR <-> PMCT links come ONLY from the Linked Request List (either side may hold the row).
  // A row is all it takes — no other field (Linkage Type etc.) is checked.
  const prByNum = {}, topByNum = {};
  for (const p of prs) { prByNum[p.num] = p; p.pmcts = []; }
  for (const t of tops) { topByNum[t.num] = t; t.srcPr = []; }
  const pair = (p, t) => {
    if (!p || !t) return;
    if (t.srcPr.indexOf(p.num) === -1) t.srcPr.push(p.num);
    if (!/^cancel/i.test(t.status) && p.pmcts.indexOf(t) === -1) p.pmcts.push(t);
  };
  for (const p of prs) for (const l of p.links) if (l.type === "PMCT") pair(p, topByNum[l.num]);
  for (const t of tops) for (const l of t.links) if (l.type === "PR") pair(prByNum[l.num], t);
  for (const t of tops) {
    const srfs = t.links.filter((l) => l.type === "SRF").map((l) => l.num);
    t.srcLinks = t.srcPr.map((n) => `PR ${n}`).concat(srfs.map((n) => `SRF ${n}`));
    t.source = t.srcLinks.join(", ");
    // Days out for signature: sent -> signed TOP back (or today while still out).
    t.age = t.lane === "delivered" && t.sigSent ? pmDays(t.sigSent, t.sigBack || today) : null;
    t.bucket = t.lane !== "delivered" ? "pre" : t.age == null ? "unk" : t.age > 30 ? "a31" : t.age > 15 ? "a30" : "a15";
  }
  for (const p of prs) p.flags = pmPrFlags(p, today);
  for (const t of tops) t.flags = pmTopFlags(t, today);
  // PRs that need a TOP but have no PMCT in the Linked Request List — every PR, no start date.
  const noTop = prs.filter((p) => p.flags.some((f) => f.key === "notop"));
  const data = { prs, tops, noTop, pls, today, prSlot, pmSlot, plsSlot };
  _pmCache = { pr: prSlot, pm: pmSlot, pls: plsSlot, key, data };
  return data;
}

/* -------------------------------------------------------------------------
   PLS UDQ — pulled from ATLAS (pmPullPls) or dropped. Any drop zone on the
   three tabs routes a PLS export here and PR / PMCT exports to the Christmas Tree slots.
   ------------------------------------------------------------------------- */
const PmPls = { slot: null, status: "", err: false };
function pmPlsStatus(msg, err) {
  PmPls.status = msg || ""; PmPls.err = !!err;
  const s = document.getElementById("pmPlsStatus");
  if (s) { s.textContent = PmPls.status; s.classList.toggle("err", PmPls.err); }
}
function pmIsPlsGrid(grid) { return /^pls number$/i.test(normWs(gridCell(grid, 1, 1))); }
async function pmIngest(files) {
  const list = Array.from(files || []).filter((f) => /\.xlsx?$/i.test(f.name));
  const rest = [];
  for (const f of list) {
    let grid = null;
    try { grid = workbookToGrid(await f.arrayBuffer()); } catch (e) { rest.push(f); continue; }
    if (!pmIsPlsGrid(grid)) { rest.push(f); continue; }
    const n = pmBlocks(grid, /^PLS-/i).length;
    if (!n) { pmPlsStatus(`No PLS records found in "${f.name}".`, true); continue; }
    PmPls.slot = { fileName: f.name, grid, at: 0 };
    pmPlsStatus(`Loaded ${n} PLS records from ${f.name}.`, false);
  }
  if (rest.length && typeof xtIngestFiles === "function") await xtIngestFiles(rest);
  else renderWorkspace();
}

/* PLS from ATLAS — Settings › ATLAS UDQ IDs › PLS UDQ. /api/UDQ/{id} returns one object per PLS
   (named fields + lists). It's laid out exactly like the PLS UDQ export so pmParsePls reads both:
   fields -> header row 1 (export column names), lists -> titled col-B sections (export titles). */
function pmPlsId() { try { return typeof atlasIds === "function" ? String(atlasIds().pls || "").trim() : ""; } catch (e) { return ""; } }
const PM_PLS_JSON_COLS = [   // [JSON field, PLS UDQ export column]
  ["PLSNumber", "PLS Number"], ["CurrentStatus", "Status"], ["AssociatedDTROrIRNumber", "Associated DTR/IR Number"],
  ["TeamOrEventName", "Team/Event Name"], ["RedFlag", "Red Flag"], ["RedFlagComments", "Red Flag Comments"],
  ["DestinationCountry", "Destination Country"], ["DestinationCity", "Destination City"], ["StartDate", "Start Date"], ["EndDate", "End Date"],
  ["CTFundingProgram", "CT Funding Program"], ["TotalCost", "Total Cost in USD"], ["CTRequestorName", "CT Requestor Name"],
  ["CTProjectManagerName", "CT Project Manager Name"], ["TTIPOCName", "TTI POC Name"], ["TTIAlternatePOCName", "TTI Alternate POC Name"],
  ["DateSubmitted", "Date Submitted"], ["TypeOfTravel", "Type Of Travel"], ["ContractCLINId", "Contract CLIN"],
  ["PurposeOrRequestSummary", "Purpose of Travel/Request Summary"],
];
const PM_PLS_JSON_SVCS = [   // [JSON list, export section title] — vendor services (one row per line item)
  ["LodgingList", "Lodging List"], ["GroundTransportationList", "Ground Transportation List"], ["TicketsList", "TTI-procured Ticket"],
  ["InterpretationList", "Interpretation List"], ["InterpretationEquipmentList", "Interpretation Equipment List"], ["TranslationList", "Translation List"],
  ["VisaArrangementsList", "Visa Arrangement List"], ["VenueList", "Venue List"], ["CateringList", "Catering List"], ["EquipmentList", "Equipment List"],
  ["OnsiteSupportList", "Onsite Support List"], ["StipendOrPerDiemOrHonorariaList", "Stipend/Per Diem/Honoraria List"],
  ["PrintedMaterialList", "Printed Material List"], ["SuppliesList", "Supplies List"], ["OtherServicesList", "Other Services List"],
];
function pmPlsJsonToGrid(recs) {
  const s = (v) => v == null ? null : String(v);
  const grid = [PM_PLS_JSON_COLS.map((c) => c[1])];
  for (const r of recs) {
    if (!r || !r.PLSNumber) continue;
    grid.push(PM_PLS_JSON_COLS.map(([k]) => s(r[k])));
    const sec = (title, hdr, rows) => { if (!rows.length) return; grid.push([null, title]); grid.push([null].concat(hdr)); rows.forEach((x) => grid.push([null].concat(x))); };
    sec("Participants List", ["Name", "Affiliation", "Number of Participants"],
      (r.ParticipantsList || []).map((p) => [s(p.name) || "—", s(p.affiliation), s(p.noOfParticipants)]));
    for (const [k, title] of PM_PLS_JSON_SVCS)
      sec(title, ["Line Item Id", "Vendor Name"], (r[k] || []).map((x) => [s(x.lineItemNumber) || "—", s(x.vendorName)]));
    sec("Linked Request List", ["Request Type", "Request Number", "Linkage Type", "Linkage Comment", "Status"],
      (r.LinkedRequests || []).map((l) => [s(l.mappedRequestCategory), s(l.mappedRequestNumber), s(l.linkTypeText), s(l.comments), s(l.statusName)]));
    const logs = (r.WorkflowLogs || []).slice().sort((a, b) => String(b.createdDate || "").localeCompare(String(a.createdDate || "")));   // newest first, like the export
    sec("Workflow Logs", ["Status", "Date/Time", "User", "Rejected Reason", "Total Cost"],
      logs.map((w) => [s(w.statusDisplay || w.statusName), s(w.createdDate), s(w.createdByText), s(w.rejectComment), s(w.totalCostHist)]));
  }
  return grid;
}
async function pmPullPls() {
  try {
    const recs = await atlasFetchUdqJson(pmPlsId());
    const grid = pmPlsJsonToGrid((recs || []).filter(Boolean));
    const n = pmParsePls(grid).filter((r) => r.status).length;
    if (!n) { pmPlsStatus("Pulled the PLS UDQ from ATLAS, but couldn't read its layout yet — keep dropping the PLS export until the Utility is updated for it.", true); return; }
    PmPls.slot = { fileName: "ATLAS PLS UDQ", grid, at: Date.now() };
    pmPlsStatus("", false);
  } catch (e) { console.error(e); pmPlsStatus(`Couldn't pull the PLS UDQ from ATLAS — ${e.message || e}`, true); }
}

/* -------------------------------------------------------------------------
   AUTO-PULL — clicking Dashboard (or opening one of these tabs) pulls the PR, PMCT
   and PLS UDQs from ATLAS in the background. Dropped files are left alone.
   ------------------------------------------------------------------------- */
const PmPull = { busy: false };
function pmFresh(slot) { return slot && slot.at && Date.now() - slot.at < PM_AUTO_PULL_MIN * 60000; }
async function pmAutoPull(force) {
  if (PmPull.busy || typeof loadFromAtlasXmasTree !== "function") return;
  const pr = XTree.slots.PR, pm = XTree.slots.PMCT, pl = PmPls.slot;
  const needPm = force || !((pmFresh(pr) && pmFresh(pm)) || (pr && !pr.at) || (pm && !pm.at));
  const needPls = !!pmPlsId() && (force || !(pmFresh(pl) || (pl && !pl.at)));
  if (!needPm && !needPls) return;
  PmPull.busy = true;
  if (pmIsTool(AppState.activeTool)) renderWorkspace();
  await Promise.all([
    needPm ? loadFromAtlasXmasTree({ services: ["PR", "PMCT"], quiet: true })
      .catch((e) => { console.error(e); xtSetStatus(`Couldn't pull the PR / PMCT UDQs from ATLAS — ${e.message || e}`, true); }) : null,
    needPls ? pmPullPls() : null,
  ]);
  PmPull.busy = false;
  if (pmIsTool(AppState.activeTool)) renderWorkspace();
  else if (typeof copHubRefreshTabs === "function" && copHubActive()) copHubRefreshTabs();   // light up the tabs that now have data
}
/* Green refresh button (Procurement, Property and PLS): pulls the PR, PMCT and PLS UDQs from ATLAS again. */
function pmRefreshBtn(title) {
  return `<button class="copx-btn ghost pmx-icon pmx-refresh" type="button" id="pmRefresh" title="${esc(title)}" aria-label="Refresh from ATLAS" ${PmPull.busy ? "disabled" : ""}>
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" class="${PmPull.busy ? "spin" : ""}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4.5 10.5A7.5 7.5 0 0 1 18 7"/><path d="M18.5 3v4.5H14"/><path d="M19.5 13.5A7.5 7.5 0 0 1 6 17"/><path d="M5.5 21v-4.5H10"/></svg></button>`;
}
function pmPulledText(slot) {
  return slot && slot.at ? `pulled ${new Date(slot.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "dropped file";
}

/* -------------------------------------------------------------------------
   UI STATE
   ------------------------------------------------------------------------- */
const PmUi = {
  proc: { view: "active", poc: "", q: "", drafts: false, attn: false, quick: "", sort: { k: "", d: 1 }, open: new Set(), period: "90" },
  prop: { view: "active", poc: "", q: "", drafts: false, attn: false, quick: "", sort: { k: "", d: 1 }, open: new Set(), period: "90" },
  pls:  { view: "active", poc: "", q: "", drafts: false, attn: false, quick: "", sort: { k: "", d: 1 }, open: new Set(), period: "90", tripDays: 30 },
  slide: false,
  slideFiltered: false,     // weekly slide: use each tab's filters instead of the whole contract
  viewEdit: "",             // tab whose View settings panel is open
};
function pmRerender() { if (pmIsTool(AppState.activeTool)) renderWorkspace(); }

/* -------------------------------------------------------------------------
   INFO BUBBLES — "how this is calculated" (Settings › General can turn them off).
   ------------------------------------------------------------------------- */
const PM_CLOSED_TXT = "Active = every status except Completed, Ready To Invoice, Invoiced and Cancelled. Drafts count only when \"Show drafts\" is ticked.";
const PM_INFO = {
  prOpen: `<b>Open PRs</b><br>${PM_CLOSED_TXT}<br>$ = sum of <b>Total Cost in USD</b>.`,
  estDue: `<b>Estimates due</b><br>PRs in <b>TTI Estimate Preparation</b>. Due date = the later of the newest <b>DTRA Compliance Review (Approved)</b> log date and the date the PR entered this status, + 3 business days (weekends and holidays skipped).<br>Counted when due within ${PM_SOON_DAYS} days or overdue.`,
  poDue: `<b>POs expected</b><br>PRs in <b>Sourcing</b>. Due date = the newest <b>DTRA Estimate Review (Approved)</b> log date (or the date it entered Sourcing), + 1 business day (weekends and holidays skipped).<br>Counted when due within ${PM_SOON_DAYS} days or overdue. A PR stays here until its status moves past Sourcing, so one with several POs counts until all are issued.`,
  rdd: `<b>Past RDD</b><br>PRs whose <b>NLT Completion Date</b> has passed and that have no <b>Delivery Date</b> yet.<br>$ = their Total Cost in USD.`,
  bigPr: `<b>Over $100K</b><br>PRs with <b>Total Cost in USD</b> of $100,000 or more.`,
  prAttn: `<b>Need attention</b><br>PRs with at least one pill in the Attention column: red flag, estimate or PO overdue, past or near RDD, no Activity Tracker update in ${PM_STALE_DAYS} days, no PO Issued entry, or TOP required with no linked PMCT.`,
  topOpen: `<b>Open TOPs</b><br>${PM_CLOSED_TXT}<br>$ = sum of property value: <b>Value of Cargo (USD)</b> (if blank, inventory Quantity × Value(USD)).`,
  topDelivered: `<b>Out for signature</b><br>Open PMCTs with an Activity Tracker <b>PMCT – TOP submitted for signature</b> entry (or status <b>Delivered</b>) — the TOP package is with the government, waiting for the signed TOP.`,
  top30: `<b>Out &gt; 30 days</b><br>TOPs out for signature more than 30 days: today (or the <b>PMCT – Signed TOP returned to TTI</b> date) − the <b>PMCT – TOP submitted for signature</b> date. TOPs with no "submitted" entry aren't counted — they show as "Sent – date unknown".`,
  bigTop: `<b>$200K and over</b><br>Open TOPs (any step) with a property value of $200,000 or more.`,
  redFlag: `<b>Red flags</b><br>PMCTs with <b>Red Flag</b> = True.`,
  topAttn: `<b>Need attention</b><br>TOPs with at least one pill in the Attention column: red flag, out for signature 16+ days, signed TOP back but PMCT not Completed, a missing <b>TOP submitted for signature</b> or <b>Signed TOP returned to TTI</b> Activity entry, no property value, or no linked PR or SRF.`,
  dotPlot: `<b>Open PRs by buyer</b><br>One row per <b>TTI POC Name</b>, sorted by their total $. Each dot is one PR placed at its <b>Total Cost in USD</b> (log scale from $1K; hollow = no cost yet), coloured by step.<br>Right side = number of PRs · total $.`,
  topBars: `<b>Open TOPs by owner</b><br>One bar per <b>TTI POC Name</b>. Each segment counts that owner's TOPs by days out for signature (from the <b>TOP submitted for signature</b> Activity entry). Bars are scaled to the owner with the most TOPs.<br>Right side = number of TOPs · total property value.`,
  next7: `<b>Next ${PM_SOON_DAYS} days</b><br>Cost estimates due and POs expected use the same rules as the tiles above (overdue included, soonest first).<br>"Waiting on CT Program &gt; $100K" lists PRs whose status contains 100K, with days since they entered that status.`,
  backlog: `<b>TOP backlog</b><br>Tiles count TOPs out for signature by days since the <b>PMCT – TOP submitted for signature</b> Activity entry: 0–15, 16–30, over 30.<br>Oldest open TOPs = the 6 with the most days.<br>"TOP required — no PMCT" = PRs (any status but Draft / Cancelled) with <b>TOP Required = Yes</b> and no PMCT in either request's <b>Linked Request List</b>.`,
  prTable: `<b>Columns</b><br><b>In status</b> = days since the newest Workflow Log entry matching the current status.<br><b>Next due</b> = estimate or PO due date (rules on the tiles).<br><b>Latest update</b> = newest Activity Tracker entry with a note.<br><b>PO</b> = first Activity Tracker <b>PR – PO Issued</b> date. <b>Delivered</b> = the PR's <b>Delivery Date</b> field.<br><b>Record fixes</b> = data the TTI POC needs to correct in ATLAS.`,
  topTable: `<b>Columns</b><br><b>From</b> = PRs / SRFs in the <b>Linked Request List</b>.<br><b>Sent for signature</b> = Activity entry <b>PMCT – TOP submitted for signature</b>. <b>Signed TOP back</b> = Activity entry <b>PMCT – Signed TOP returned to TTI</b>. <b>Days out</b> = days between them (or to today).<br><b>Latest update</b> = newest Activity Tracker entry with a note.<br><b>Record fixes</b> = data the TTI POC needs to correct in ATLAS.`,
  slide: `<b>Weekly slide</b><br>Counts every active, non-draft PR, TOP and PLS on the contract — or only what the tab filters show when "Use the dashboard filters" is ticked. The charts show the 7 busiest buyers / owners; any more share one "others" bar. Lists that can't all fit at a readable size are grouped (by buyer / by country) or counted instead — the full lists are always in the PowerPoint's slide notes. The PLS quadrant fills once a PLS UDQ is loaded. Notes are typed below.`,
  plsOpen: `<b>Open PLS</b><br>${PM_CLOSED_TXT}<br>$ = sum of <b>Total Cost in USD</b>.`,
  plsDtra: `<b>Estimate with DTRA</b><br>PLS in <b>DTRA Estimate Review</b> or <b>Fulfillment Review</b> — TTI's estimate is waiting on approval.<br>Below = days the oldest one has waited (since it entered that status).`,
  plsTrips: `<b>Trips in the next 30 / 60 / 90 days</b><br>Open PLS whose <b>Start Date</b> is today or within the window picked in <b>Trips in next</b> (30 days unless changed).<br>Below = travelers: one per <b>Participants List</b> row (or that row's <b>Number of Participants</b> when it's more than 1).`,
  plsNow: `<b>Traveling now</b><br>Open PLS where today is between the <b>Start Date</b> and <b>End Date</b>.`,
  plsAttn: `<b>Need attention</b><br>PLS with at least one pill in the Attention column: red flag, trip ended but still In Progress, or record fixes (no Start / End Date, approved with no Total Cost, no TTI POC).`,
  plsTimeline: `<b>Trips — next 30 / 60 / 90 days</b> (the <b>Trips in next</b> pick)<br>One bar per open PLS from its <b>Start Date</b> to <b>End Date</b>, coloured by step. Trips already underway show from the left edge. The red line is today.`,
  plsActions: `<b>Trip ended, still In Progress</b><br>Open PLS in <b>In Progress</b> whose <b>End Date</b> has passed — the PLS should move to Completed.`,
  plsTable: `<b>Columns</b><br><b>Travelers</b> = Participants List rows (or a row's Number of Participants when more than 1).<br><b>In status</b> = days since the newest Workflow Log entry matching the current status.<br><b>Record fixes</b> = data the TTI POC needs to correct in ATLAS.`,
  lane: {
    pr_draft: "ATLAS status <b>Draft</b>.",
    pr_review: "Every open status not in another step — e.g. DTRA Compliance Review, DTRA Program Review, TTI Quality Review.<br>Count · total of Total Cost in USD · the 3 most common statuses.",
    pr_estimate: "Statuses containing <b>Estimate</b> or <b>100K</b> — TTI Estimate Preparation, DTRA Estimate Review, CT Program &gt; 100K Approval.<br>Count · total of Total Cost in USD · the 3 most common statuses.",
    pr_sourcing: "Status <b>Sourcing</b>. A PR stays here until all its POs are issued.<br>Count · total of Total Cost in USD.",
    pr_exec: "Statuses containing Production, Delivery, Shipped or Received — e.g. <b>Production or Delivery</b>.<br>Count · total of Total Cost in USD.",
    top_draft: "ATLAS status <b>Draft</b>.",
    top_approved: "Open PMCTs (normally <b>DTRA Approved</b> — PMCTs skip DTRA review) with no <b>TOP submitted for signature</b> Activity entry yet.<br>Count · total property value.",
    top_delivered: "Open PMCTs with a <b>PMCT – TOP submitted for signature</b> Activity entry, or status <b>Delivered</b>.<br>Count · total property value.",
    pls_draft: "ATLAS status <b>Draft</b>.",
    pls_review: "<b>DTRA Program Review</b> (and any other status not in another step).<br>Count · total of Total Cost in USD.",
    pls_estimate: "<b>TTI Estimate Preparation</b> — TTI is preparing the cost estimate.<br>Count · total of Total Cost in USD.",
    pls_approval: "<b>DTRA Estimate Review</b> or <b>Fulfillment Review</b> — estimate waiting on approval.<br>Count · total of Total Cost in USD.",
    pls_booked: "<b>In Progress</b> — estimate approved, trip booked or underway.<br>Count · total of Total Cost in USD.",
  },
};
function pmInfoOn() { try { return typeof AtlasSettings === "undefined" || AtlasSettings.get().dashInfo !== false; } catch (e) { return true; } }
function pmInfo(html) {
  if (!html || !pmInfoOn()) return "";
  return `<span class="pmx-info" data-tip="${esc(html)}" role="img" aria-label="How this is calculated">i</span>`;
}

const PMX_CSS = `
.pmx{--pm-r1:#86b6ef;--pm-r2:#3987e5;--pm-r3:#1c5cab;--pm-r4:#0d366b;--pm-grid:#e3e8ef}
body.theme-dark .pmx{--pm-grid:#2a3744}
.pmx-top{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;border-bottom:2px solid var(--ax-line);margin-top:-4px}
.pmx-top .copx-tabs{border-bottom:0;margin-top:0}
.pmx-tools{display:flex;gap:8px;align-items:center;margin-left:auto;padding-bottom:6px;flex-wrap:wrap}
.pmx-tools .copx-btn{min-height:32px;padding:6px 14px}
.pmx-src{font-size:11.5px;color:var(--ax-muted)}
.pmx-tools .copx-btn.pmx-icon{padding:6px 9px;display:inline-flex;align-items:center;justify-content:center}
.pmx-icon svg.spin{animation:pmx-spin 1s linear infinite}
.pmx-tools .copx-btn.pmx-refresh{color:#2e7d32;border-color:#81c784;background:#f1f8f1}
.pmx-tools .copx-btn.pmx-refresh:hover:not(:disabled){background:#dcefdc;border-color:#2e7d32}
.pmx-tools .copx-btn.pmx-viewbtn{position:relative}
.pmx-vdot{position:absolute;top:3px;right:3px;width:7px;height:7px;border-radius:50%;background:var(--ax-blue,#3987e5)}
body.theme-dark .pmx-tools .copx-btn.pmx-refresh{color:#81c784;border-color:#3f7a45;background:#1b2a1e}
@keyframes pmx-spin{to{transform:rotate(360deg)}}
.pmx-info{display:inline-flex;align-items:center;justify-content:center;flex:none;width:15px;height:15px;border-radius:50%;border:1.4px solid currentColor;
  font:italic 700 10px Georgia,serif;color:var(--ax-muted);cursor:help;margin-left:6px;vertical-align:middle;opacity:.85}
.pmx-info:hover{opacity:1;color:var(--ax-blue)}
.pmx-kpi .k .pmx-info{margin-left:auto}
.pmx-lane .lh .pmx-info{margin-left:auto;color:#fff}
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
.pmx-lane{border:1px solid var(--ax-line);border-radius:10px;background:var(--ax-soft);overflow:hidden;cursor:pointer;text-align:left;padding:0;font:inherit;color:var(--ax-ink);
  display:flex;flex-direction:column;justify-content:flex-start;align-items:stretch}   /* header pinned to the top even when a lane is shorter */
.pmx-lane.on{box-shadow:0 0 0 2px var(--ax-blue);border-color:var(--ax-blue)}
.pmx-lane .lh{background:var(--ax-navy);color:#fff;padding:8px 12px;display:flex;align-items:center;gap:8px;font-weight:600;font-size:12.5px}
.pmx-lane .lb{padding:8px 12px 10px}
.pmx-lane .n{font-size:24px;font-weight:700;line-height:1.1}
.pmx-lane .m{font-size:12px;color:var(--ax-ink2);margin-bottom:6px}
.pmx-lane .st{font-size:11px;color:var(--ax-muted);display:flex;justify-content:space-between;gap:6px}
.pmx-grid2{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:16px}
.pmx-grid2.one{grid-template-columns:minmax(0,1fr)}
@media (max-width:1100px){.pmx-grid2{grid-template-columns:1fr}}
.pmx-tools .copx-btn.on{border-color:var(--ax-blue);box-shadow:0 0 0 2px var(--ax-blue)}
.pmx-view{border:1px solid var(--ax-line);border-radius:10px;background:var(--ax-card);padding:12px 16px;margin:0 0 16px}
.pmx-view .vh{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.pmx-view .vh h3{margin:0;font-size:14px;font-weight:600}
.pmx-view .vh .sub{font-size:11.5px;color:var(--ax-muted)}
.pmx-view .vh .acts{margin-left:auto;display:flex;gap:8px}
.pmx-view h4{margin:10px 0 4px;font-size:11.5px;font-weight:700;color:var(--ax-muted);text-transform:uppercase;letter-spacing:.04em}
.pmx-view .grp{display:flex;flex-wrap:wrap;gap:4px 18px}
.pmx-view .grp label{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer}
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
.pmx-svg .tb{cursor:pointer}
.pmx-svg .tb:hover rect{stroke:var(--ax-ink);stroke-width:1.5}
.pmx-svg .now{stroke:var(--ax-red);stroke-width:1.5;stroke-dasharray:3 3}
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
/* The preview draws the same plan as the .pptx: positions in inches -> % of 13.333 x 7.5, points -> cqw. */
.pmx-slide{container-type:inline-size;aspect-ratio:16/9;width:100%;max-width:1100px;margin:0 auto 14px;background:#fff;color:#1f2d3d;border-radius:6px;
  box-shadow:0 2px 10px rgba(20,30,60,.22);position:relative;overflow:hidden;font-family:Calibri,Carlito,"Segoe UI",sans-serif}
.pmx-slide .o{position:absolute;box-sizing:border-box}
.pmx-slide .bx{border:1px solid #e1e6ee}
.pmx-slide .tx{line-height:1.2;overflow:visible}
.pmx-slide .tx p{margin:0 0 .2cqw}
.pmx-slide .tx p.b{padding-left:1.4cqw;text-indent:-1cqw}
.pmx-slide .tx p.b::before{content:"•";display:inline-block;width:1cqw;text-indent:0}
.pmx-slide .ch{display:flex;flex-direction:column}
.pmx-slide .ch .t{font-weight:700;text-align:center}
.pmx-slide .ch .pl{flex:1;display:flex;min-height:0;gap:.6cqw}
.pmx-slide .ch .cols{flex:1;display:flex;align-items:stretch;gap:.6cqw;min-width:0}
.pmx-slide .ch .c{flex:1;display:flex;flex-direction:column;min-width:0}
.pmx-slide .ch .stk{flex:1;display:flex;flex-direction:column-reverse;min-height:0}
.pmx-slide .ch .sg{color:#fff;display:flex;align-items:center;justify-content:center;min-height:0;border-top:1px solid #fff}
.pmx-slide .ch .cl{text-align:center;white-space:pre-line;line-height:1.1;margin-top:.2cqw}
.pmx-slide .ch .bars{flex:1;display:grid;grid-template-columns:auto 1fr;gap:.25cqw .5cqw;align-content:space-evenly;align-items:center;min-height:0}
.pmx-slide .ch .tr{display:flex;height:100%;max-height:1.6cqw;min-height:.8cqw}
.pmx-slide .ch .tr .sg{height:100%;border-top:0;border-left:1px solid #fff}
.pmx-slide .ch .lg{display:flex;flex-direction:column;justify-content:center;gap:.25cqw;color:#5a6778}
.pmx-slide .ch .lg.h{flex-direction:row;flex-wrap:wrap;justify-content:center;gap:.2cqw .8cqw}
.pmx-slide .ch .lg i{display:inline-block;width:.8cqw;height:.8cqw;border-radius:2px;margin-right:.3cqw;vertical-align:middle}
.pmx-swarn{font-size:12px;color:var(--ax-red);margin:-6px 0 10px;text-align:center}
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
    n.addEventListener("mousemove", (e) => { e.stopPropagation(); pmTip(e, n.getAttribute("data-tip")); });
    n.addEventListener("mouseleave", () => pmTip(null));
  });
  // Info bubbles also open on click / tap (and must not trigger the tile they sit on).
  root.querySelectorAll(".pmx-info").forEach((n) => n.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    const r = n.getBoundingClientRect();
    pmTip({ clientX: r.left, clientY: r.bottom }, n.getAttribute("data-tip"));
    setTimeout(() => document.addEventListener("click", () => pmTip(null), { once: true }), 0);
  }));
}

/* -------------------------------------------------------------------------
   RENDER
   ------------------------------------------------------------------------- */
function renderProcWorkspace(container) { pmRender(container, "proc"); }
function renderPropWorkspace(container) { pmRender(container, "prop"); }
function renderPlsWorkspace(container) { pmRenderPls(container); }

/* PLS tab — same layout as Procurement / Property, fed by a dropped PLS UDQ. */
function pmRenderPls(container) {
  pmTip(null);
  const ui = PmUi.pls;
  const root = el(`<div class="copx pmx"><style>${typeof COPX_CSS !== "undefined" ? COPX_CSS : ""}${PMX_CSS}</style></div>`);
  container.appendChild(root);
  const D = pmData();
  if (!D.plsSlot) { root.appendChild(pmPlsEmptyCard()); return; }
  const all = D.pls;
  const active = all.filter((r) => !r.closed), closed = all.filter((r) => r.closed);
  const drafts = active.filter((r) => r.lane === "draft").length;
  const isActive = ui.view !== "closed";
  const tabs = el(`<div class="pmx-top"><div class="copx-tabs" role="tablist">
    <button type="button" data-v="active" class="${isActive ? "on" : ""}" role="tab" aria-selected="${isActive}">Active PLS (${active.length - (ui.drafts ? 0 : drafts)})</button>
    <button type="button" data-v="closed" class="${!isActive ? "on" : ""}" role="tab" aria-selected="${!isActive}">Closed PLS (${closed.length})</button></div>
    <div class="pmx-tools"><span class="pmx-src">PLS UDQ · ${esc(pmPulledText(D.plsSlot))}${PmPull.busy ? " · refreshing…" : ""}</span>
      ${pmRefreshBtn("Refresh — pull the PLS UDQ from ATLAS again")}
      ${PM_VIEW_BTN("pls")}
      <button class="copx-btn ${PmUi.slide ? "blue" : "green"}" type="button" id="pmSlideBtn">${PmUi.slide ? "Close weekly slide" : "Weekly slide"}</button></div>
  </div>`);
  tabs.querySelectorAll("button[data-v]").forEach((b) => b.addEventListener("click", () => { ui.view = b.dataset.v; ui.quick = ""; ui.open = new Set(); pmRerender(); }));
  tabs.querySelector("#pmRefresh").addEventListener("click", () => {
    if (!pmPlsId()) pmPlsStatus("No PLS UDQ ID is set — add it in Settings › ATLAS UDQ IDs, or drop a newer PLS export.", true);
    pmAutoPull(true);
  });
  pmWireViewBtn(tabs, "pls");
  tabs.querySelector("#pmSlideBtn").addEventListener("click", () => { PmUi.slide = !PmUi.slide; pmRerender(); });
  root.appendChild(tabs);
  root.appendChild(el(`<div class="pmx-status ${PmPls.err ? "err" : ""}" id="pmPlsStatus" style="margin-top:-8px">${esc(PmPls.status || "")}</div>`));
  if (PmUi.viewEdit === "pls") root.appendChild(pmViewPanel("pls", isActive));
  if (PmUi.slide) root.appendChild(pmSlideCard(D));

  const base = isActive ? active.filter((r) => ui.drafts || r.lane !== "draft") : pmClosedWindow(closed, ui.period);
  const rows = pmFilter(base, ui, "pls");
  const card = el(`<section class="copx-card">
    <div class="copx-hd"><h2>${isActive ? "Personnel Logistics Services — Active PLS" : "Personnel Logistics Services — Closed PLS"}</h2>
      <span class="n">${rows.length === base.length ? `${base.length} PLS` : `${rows.length} of ${base.length} PLS`} · ${pmMoney(pmSum(rows, "cost"))}</span>
      <div class="acts"><button class="copx-btn" id="pmExport" type="button">Export to Excel</button></div></div>
    <div class="copx-rule"></div></section>`);
  root.appendChild(card);
  card.querySelector("#pmExport").addEventListener("click", () => pmExportXlsx("pls", rows, isActive));
  card.appendChild(pmFilterBar("pls", isActive ? active : closed, isActive, drafts));
  if (isActive) {
    const viewBase = pmFilter(base, Object.assign({}, ui, { quick: "", attn: false }), "pls");
    card.appendChild(pmPlsKpis(viewBase));
    pmPanels(card, "pls", () => pmLanes(viewBase, ui, "pls"), () => pmPlsTimeline(viewBase), () => pmPlsActions(viewBase));
  }
  const tcard = el(`<section class="copx-card"><div class="copx-hd"><h2>${isActive ? "PLS details" : "Closed"}${pmInfo(PM_INFO.plsTable)}</h2>
    <span class="n">Click a row for travel, services and milestones · click a header to sort</span></div><div class="copx-rule"></div></section>`);
  root.appendChild(tcard);
  tcard.appendChild(pmTable("pls", rows, isActive));
  pmWireTips(root);
}
function pmPlsEmptyCard() {
  const card = el(`<section class="copx-card">
    <div class="copx-hd"><h2>Personnel Logistics Services (PLS)</h2></div><div class="copx-rule"></div>
    <p class="copx-msg">This tab runs on the PLS UDQ. Inside ATLAS it pulls automatically once the PLS UDQ ID is set in Settings. Elsewhere, drop the PLS UDQ export below (it stays loaded until the page is reloaded).</p>
    <div class="pmx-drop" id="pmDrop" tabindex="0" role="button">Drop the PLS UDQ export (.xlsx) here, or click to browse</div>
    <input type="file" id="pmFile" accept=".xlsx,.xls" multiple hidden>
    <div class="pmx-status ${PmPls.err ? "err" : ""}" id="pmPlsStatus">${esc(PmPls.status || "")}</div>
  </section>`);
  pmWireDrop(card.querySelector("#pmDrop"), card.querySelector("#pmFile"));
  return card;
}
function pmPlsKpis(rows) {
  const today = pmToday();
  const dtra = rows.filter((r) => r.lane === "approval");
  const oldest = dtra.reduce((m, r) => Math.max(m, r.statusSince ? pmDays(r.statusSince, today) : 0), 0);
  const tripDays = PmUi.pls.tripDays;
  const trips = rows.filter((r) => pmTripSoon(r, today, tripDays));
  const now = rows.filter((r) => r.phase === "now");
  const ended = rows.filter((r) => r.flags.some((f) => f.key === "ended"));
  const attn = rows.filter((r) => r.flags.length);
  return pmKpiGrid("pls", [
    { id: "open", label: "Open PLS", v: rows.length, s: `${pmMoney(pmSum(rows, "cost"))} total cost`, info: PM_INFO.plsOpen },
    { id: "trips", key: "trips", label: `Trips in next ${tripDays} days`, v: trips.length, s: `${pmPlural(pmSum(trips, "travelers"), "traveler")}`, info: PM_INFO.plsTrips },
    { id: "now", key: "now", label: "Traveling now", v: now.length, s: now.length ? pmPlural(pmSum(now, "travelers"), "traveler") : "&nbsp;", info: PM_INFO.plsNow },
    { id: "dtra", key: "lane:approval", label: "Estimate with DTRA", v: dtra.length, s: dtra.length ? `oldest ${pmPlural(oldest, "day")}` : "&nbsp;", info: PM_INFO.plsDtra },
    { id: "ended", key: "ended", label: "Trip ended, still In Progress", v: ended.length, s: "&nbsp;", info: PM_INFO.plsActions },
    { id: "attn", key: "attn", label: "Need attention", v: attn.length, s: `${attn.filter((r) => r.flags.some((f) => f.lvl === "red")).length} with a red item`, info: PM_INFO.plsAttn },
  ]);
}
/** Trip starts today or within the next `days` days (the PLS "Trips in next" window: 30 / 60 / 90). */
function pmTripSoon(r, today, days) { return !!r.start && pmDays(today, r.start) >= 0 && pmDays(today, r.start) <= days; }
/* Trips — next 30 / 60 / 90 days (the "Trips in next" pick): one bar per open PLS from Start Date to End Date, coloured by step. */
function pmPlsTimeline(rows) {
  const today = pmToday(), SPAN = PmUi.pls.tripDays, MAXR = 18;
  const panel = el(`<div class="pmx-panel"><h3>Trips — next ${SPAN} days${pmInfo(PM_INFO.plsTimeline)}</h3>
    <div class="sub">Start to end date · coloured by step · click a bar to open it in the table</div>
    <div class="pmx-legend">${PM_PLS_LANES.filter((l) => l.id !== "draft").map((l) => `<span><i class="pmx-dot" style="background:${l.color}"></i>${esc(l.label)}</span>`).join("")}</div></div>`);
  const trips = rows.filter((r) => r.start && pmDays(today, r.start) <= SPAN && (r.end ? pmDays(today, r.end) >= 0 : pmDays(today, r.start) >= 0))
    .sort((a, b) => a.start - b.start || (a.end || a.start) - (b.end || b.start));
  if (!trips.length) { panel.appendChild(el(`<div class="pmx-empty">No trips in the next ${SPAN} days in this view.</div>`)); return panel; }
  const shown = trips.slice(0, MAXR);
  const W = 720, L = 190, R = 12, T = 22, RH = 20, H = T + shown.length * RH + 6;
  const x = (d) => L + Math.max(0, Math.min(SPAN, d)) / SPAN * (W - L - R);
  let svg = "";
  for (let d = 0; d <= SPAN; d += SPAN > 60 ? 14 : 7) {
    const day = xtAddDays(today, d);
    svg += `<line class="gl" x1="${x(d)}" x2="${x(d)}" y1="${T - 4}" y2="${H - 4}"/><text class="ax" x="${x(d)}" y="${T - 8}" text-anchor="middle">${esc(pmFmt(day))}</text>`;
  }
  shown.forEach((r, i) => {
    const y = T + i * RH;
    const s = pmDays(today, r.start), e = pmDays(today, r.end || r.start);
    const lane = PM_PLS_LANES.find((l) => l.id === r.lane) || PM_PLS_LANES[0];
    const x1 = x(s), x2 = Math.max(x(e + 1), x1 + 4);
    const lbl = `${r.num} · ${r.title}`;
    const tip = `<b>${esc(r.num)} · ${esc(r.title)}</b><br>${esc(r.dest)}<br>${esc(pmFmt(r.start, true))} – ${esc(pmFmt(r.end, true))} · ${pmPlural(r.travelers, "traveler")}<br>${esc(r.status)} · ${pmMoney(r.cost, true)} · ${esc(r.poc)}`;
    svg += `<text class="nm" x="${L - 8}" y="${y + 13}" text-anchor="end">${esc(lbl.length > 30 ? lbl.slice(0, 29) + "…" : lbl)}</text>
      <g class="tb" data-num="${esc(r.num)}" data-tip="${esc(tip)}"><rect x="0" y="${y}" width="${W}" height="${RH}" fill="transparent"/>
      <rect x="${x1}" y="${y + 5}" width="${x2 - x1}" height="10" rx="4" fill="${lane.color}"/></g>`;
  });
  svg += `<line class="now" x1="${x(0)}" x2="${x(0)}" y1="${T - 4}" y2="${H - 4}"/>`;
  panel.appendChild(el(`<svg class="pmx-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trips in the next ${SPAN} days">${svg}</svg>`));
  if (trips.length > MAXR) panel.appendChild(el(`<div class="sub" style="margin-top:6px">+${trips.length - MAXR} more — see the table</div>`));
  panel.querySelectorAll(".tb").forEach((g) => g.addEventListener("click", () => pmOpenRow("pls", g.dataset.num)));
  return panel;
}
function pmPlsActions(rows) {
  const ended = rows.filter((r) => r.flags.some((f) => f.key === "ended")).sort((a, b) => a.end - b.end);
  const panel = el(`<div class="pmx-panel pmx-act"><h3>Trips to close out${pmInfo(PM_INFO.plsActions)}</h3><div class="sub">Click an item to open it in the table</div>
    <h4><span>Trip ended, still In Progress</span><span>${ended.length}</span></h4>${pmActList("pls", ended, () => null, (r) => `ended ${pmFmt(r.end)}`, "None.")}
  </div>`);
  panel.querySelectorAll("li[data-num]").forEach((li) => li.addEventListener("click", () => pmOpenRow("pls", li.getAttribute("data-num"))));
  return panel;
}

/* View settings panel (opened by the View button): tick what shows on this tab. Saved per browser. */
function pmViewPanel(kind, isActive) {
  const it = PM_VIEW_ITEMS[kind];
  const cols = pmCols(kind, isActive).filter((c) => PM_VIEW_LOCKED.indexOf(c.k) === -1);
  const box = (id, label) => `<label><input type="checkbox" data-vid="${esc(id)}" ${pmShow(kind, id) ? "checked" : ""}> ${esc(label)}</label>`;
  const p = el(`<section class="pmx-view" aria-label="View settings">
    <div class="vh"><h3>View settings</h3><span class="sub">Tick what you want on this tab. Your choices are saved in this browser and become your default view.</span>
      <div class="acts"><button class="copx-btn ghost" type="button" id="pmViewReset" ${pmViewChanged(kind) ? "" : "disabled"}>Reset to recommended</button>
        <button class="copx-btn blue" type="button" id="pmViewDone">Done</button></div></div>
    ${isActive ? `<h4>Summary tiles</h4><div class="grp">${it.tiles.map(([id, l]) => box("t:" + id, l)).join("")}</div>
      <h4>Panels</h4><div class="grp">${it.panels.map(([id, l]) => box("p:" + id, l)).join("")}</div>`
    : `<div class="sub" style="font-size:11.5px;color:var(--ax-muted)">Tiles and panels are on the Active tab.</div>`}
    <h4>Table columns${isActive ? "" : " (closed)"}</h4><div class="grp">${cols.map((c) => box("c:" + c.k, c.l)).join("")}</div>
  </section>`);
  p.querySelectorAll("input[data-vid]").forEach((cb) => cb.addEventListener("change", () => {
    const id = cb.dataset.vid;
    pmViewSet(kind, id, cb.checked);
    pmRerender();
    const n = document.querySelector(`.pmx-view input[data-vid="${id}"]`); if (n) n.focus();
  }));
  p.querySelector("#pmViewReset").addEventListener("click", () => { pmViewReset(kind); pmRerender(); });
  p.querySelector("#pmViewDone").addEventListener("click", () => { PmUi.viewEdit = ""; pmRerender(); });
  return p;
}
function pmWireViewBtn(tabs, kind) {
  tabs.querySelector("#pmViewBtn").addEventListener("click", () => { PmUi.viewEdit = PmUi.viewEdit === kind ? "" : kind; pmRerender(); });
}
/** Lanes row + the chart / list pair, each only if switched on in View settings (one panel = full width). */
function pmPanels(card, kind, lanes, chart, actions) {
  if (pmShow(kind, "p:lanes")) card.appendChild(lanes());
  const parts = [];
  if (pmShow(kind, "p:chart")) parts.push(chart());
  if (pmShow(kind, "p:actions")) parts.push(actions());
  if (!parts.length) return;
  const g = el(`<div class="pmx-grid2${parts.length === 1 ? " one" : ""}"></div>`);
  parts.forEach((x) => g.appendChild(x));
  card.appendChild(g);
}

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

  const pulled = pmPulledText(slot);
  const tabs = el(`<div class="pmx-top"><div class="copx-tabs" role="tablist">
    <button type="button" data-v="active" class="${isActive ? "on" : ""}" role="tab" aria-selected="${isActive}">Active ${noun}s (${active.length - (ui.drafts ? 0 : drafts)})</button>
    <button type="button" data-v="closed" class="${!isActive ? "on" : ""}" role="tab" aria-selected="${!isActive}">Closed ${noun}s (${closed.length})</button></div>
    <div class="pmx-tools"><span class="pmx-src">${esc(isPr ? "PR" : "PMCT")} UDQ · ${esc(pulled)}${PmPull.busy ? " · refreshing…" : ""}</span>
      ${pmRefreshBtn("Refresh — pull the PR and PMCT UDQs from ATLAS again")}
      ${PM_VIEW_BTN(kind)}
      <button class="copx-btn ${PmUi.slide ? "blue" : "green"}" type="button" id="pmSlideBtn">${PmUi.slide ? "Close weekly slide" : "Weekly slide"}</button></div>
  </div>`);
  tabs.querySelectorAll("button[data-v]").forEach((b) => b.addEventListener("click", () => {
    ui.view = b.dataset.v; ui.quick = ""; ui.open = new Set(); pmRerender();
  }));
  tabs.querySelector("#pmRefresh").addEventListener("click", () => pmAutoPull(true));
  pmWireViewBtn(tabs, kind);
  tabs.querySelector("#pmSlideBtn").addEventListener("click", () => { PmUi.slide = !PmUi.slide; pmRerender(); });
  root.appendChild(tabs);
  root.appendChild(el(`<div class="pmx-status ${XTree.statusErr ? "err" : ""}" id="xtStatus" style="margin-top:-8px">${esc(XTree.status || "")}</div>`));
  if (PmUi.viewEdit === kind) root.appendChild(pmViewPanel(kind, isActive));

  if (PmUi.slide) root.appendChild(pmSlideCard(D));

  const base = isActive ? active.filter((r) => ui.drafts || r.lane !== "draft") : pmClosedWindow(closed, ui.period);
  const rows = pmFilter(base, ui, kind);

  const card = el(`<section class="copx-card">
    <div class="copx-hd"><h2>${isPr ? (isActive ? "Procurement — Active PRs" : "Procurement — Closed PRs") : (isActive ? "Property — Open TOPs (PMCT)" : "Property — Closed TOPs (PMCT)")}</h2>
      <span class="n">${rows.length === base.length ? pmPlural(base.length, noun) : `${rows.length} of ${base.length} ${noun}s`} · ${pmMoney(pmSum(rows, isPr ? "cost" : "value"))}</span>
      <div class="acts"><button class="copx-btn" id="pmExport" type="button">Export to Excel</button></div></div>
    <div class="copx-rule"></div></section>`);
  root.appendChild(card);
  card.querySelector("#pmExport").addEventListener("click", () => pmExportXlsx(kind, rows, isActive));
  card.appendChild(pmFilterBar(kind, isActive ? active : closed, isActive, drafts));

  if (isActive) {
    const viewBase = pmFilter(base, Object.assign({}, ui, { quick: "", attn: false }), kind);  // tiles count what the filters show, before a tile is picked
    card.appendChild(isPr ? pmPrKpis(viewBase, ui) : pmTopKpis(viewBase, ui));
    pmPanels(card, kind, () => pmLanes(viewBase, ui, kind),
      () => isPr ? pmPrDotPlot(viewBase) : pmTopBars(viewBase),
      () => isPr ? pmPrActions(viewBase) : pmTopActions(viewBase, D));
  }

  const tcard = el(`<section class="copx-card"><div class="copx-hd"><h2>${isActive ? (isPr ? "PR details" : "TOP details") : "Closed"}${pmInfo(isPr ? PM_INFO.prTable : PM_INFO.topTable)}</h2>
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
  const take = (files) => { if (files && files.length) pmIngest(files); };   // PLS -> PLS tab; PR / PMCT -> Christmas Tree slots
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

function pmFilter(rows, ui, kind) {
  const isPr = kind === "proc";
  const q = norm(ui.q).toLowerCase();
  let out = rows.filter((r) => {
    if (ui.poc && r.poc !== ui.poc) return false;
    if (ui.attn && !r.flags.length) return false;
    if (q && ![r.wmtr, r.title, r.poc, r.status, r.country, r.city || "", r.dtr || "", r.program, r.latest ? r.latest.note : "", r.source || ""].join(" ").toLowerCase().includes(q)) return false;
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
    else if (k === "trips") out = out.filter((r) => pmTripSoon(r, pmToday(), PmUi.pls.tripDays));
    else if (k === "now") out = out.filter((r) => r.phase === "now");
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
      if (s.k === "lane") return pmLanesFor(kind).findIndex((l) => l.id === r.lane);
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
    <div class="copx-f"><label for="pmPoc">${kind === "proc" ? "Buyer (TTI POC)" : kind === "pls" ? "TTI POC" : "Owner (TTI POC)"}</label>
      <select id="pmPoc">${opt("", "Everyone", !ui.poc)}${pocs.map((p) => opt(p, p, p === ui.poc)).join("")}</select></div>
    <div class="copx-f q"><label for="pmQ">Search</label><input type="search" id="pmQ" placeholder="${kind === "pls" ? "PLS number, team / event, country, city, DTR…" : "WMTR, title, country, note…"}" value="${esc(ui.q)}"></div>
    ${isActive ? `<label class="copx-chk"><input type="checkbox" id="pmAttn" ${ui.attn ? "checked" : ""}> Needs attention only</label>
      <label class="copx-chk"><input type="checkbox" id="pmDrafts" ${ui.drafts ? "checked" : ""}> Show drafts (${drafts})</label>
      ${kind === "pls" ? `<div class="copx-f"><label for="pmTripDays">Trips in next</label><select id="pmTripDays">
        ${[30, 60, 90].map((n) => opt(String(n), `${n} days`, ui.tripDays === n)).join("")}</select></div>` : ""}`
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
  const td = bar.querySelector("#pmTripDays"); if (td) td.addEventListener("change", () => { ui.tripDays = parseInt(td.value, 10) || 30; pmRerender(); });
  const c = bar.querySelector("#pmClearQuick"); if (c) c.addEventListener("click", () => { ui.quick = ""; pmRerender(); });
  return bar;
}

function pmKpiGrid(kind, tiles) {
  const ui = PmUi[kind];
  const g = el(`<div class="pmx-kpis"></div>`);
  for (const t of tiles.filter((x) => !x.id || pmShow(kind, "t:" + x.id))) {
    const b = el(`<button type="button" class="pmx-kpi ${ui.quick === t.key ? "on" : ""}" ${t.key ? "" : 'style="cursor:default"'}>
      <div class="k">${t.dot ? `<i class="pmx-dot" style="background:${t.dot}"></i>` : ""}${esc(t.label)}${pmInfo(t.info)}</div>
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
    { id: "open", label: "Open PRs", v: rows.length, s: `${pmMoney(pmSum(rows, "cost"))} total value`, info: PM_INFO.prOpen },
    { id: "est", key: "estdue", label: `Estimates due ≤ ${PM_SOON_DAYS} days`, v: est.length, s: late(estLate), info: PM_INFO.estDue },
    { id: "po", key: "podue", label: `POs expected ≤ ${PM_SOON_DAYS} days`, v: po.length, s: late(poLate), info: PM_INFO.poDue },
    { id: "rdd", key: "rdd", label: "Past RDD", v: rdd.length, s: rdd.length ? pmMoney(pmSum(rdd, "cost")) : "&nbsp;", info: PM_INFO.rdd },
    { id: "big", key: "big", label: "Over $100K", v: big.length, s: pmMoney(pmSum(big, "cost")), info: PM_INFO.bigPr },
    { id: "attn", key: "attn", label: "Need attention", v: attn.length, s: `${attn.filter((r) => r.flags.some((f) => f.lvl === "red")).length} with a red item`, info: PM_INFO.prAttn },
  ]);
}
function pmTopKpis(rows, ui) {
  const dl = rows.filter((r) => r.lane === "delivered");
  const o30 = rows.filter((r) => r.bucket === "a31");
  const big = rows.filter((r) => r.value >= PM_BIG_TOP);
  const attn = rows.filter((r) => r.flags.length);
  return pmKpiGrid("prop", [
    { id: "open", label: "Open TOPs", v: rows.length, s: `${pmMoney(pmSum(rows, "value"))} property value`, info: PM_INFO.topOpen },
    { id: "out", key: "lane:delivered", label: "Out for signature", v: dl.length, s: pmMoney(pmSum(dl, "value")), info: PM_INFO.topDelivered },
    { id: "o30", key: "age:a31", label: "Out > 30 days", dot: "#c62828", v: o30.length, s: pmMoney(pmSum(o30, "value")), info: PM_INFO.top30 },
    { id: "big", key: "big", label: "$200K and over", v: big.length, s: pmMoney(pmSum(big, "value")), info: PM_INFO.bigTop },
    { id: "flag", key: "flag", label: "Red flags", v: rows.filter((r) => r.redFlag).length, s: "&nbsp;", info: PM_INFO.redFlag },
    { id: "attn", key: "attn", label: "Need attention", v: attn.length, s: `${attn.filter((r) => r.flags.some((f) => f.lvl === "red")).length} with a red item`, info: PM_INFO.topAttn },
  ]);
}

function pmLanes(rows, ui, kind) {
  const isPr = kind === "proc", money = kind === "prop" ? "value" : "cost";
  const lanes = pmLanesFor(kind).filter((l) => l.id !== "draft" || ui.drafts);
  const wrap = el(`<div class="pmx-lanes"></div>`);
  for (const l of lanes) {
    const rs = rows.filter((r) => r.lane === l.id);
    const by = {};
    for (const r of rs) by[r.status] = (by[r.status] || 0) + 1;
    const st = Object.keys(by).sort((a, b) => by[b] - by[a]).slice(0, 3)
      .map((s) => `<div class="st"><span>${esc(s)}</span><b>${by[s]}</b></div>`).join("");
    const key = "lane:" + l.id;
    const b = el(`<button type="button" class="pmx-lane ${ui.quick === key ? "on" : ""}">
      <div class="lh"><i class="pmx-dot" style="background:${l.color};box-shadow:0 0 0 2px #fff"></i>${esc(l.label)}${pmInfo(PM_INFO.lane[(isPr ? "pr_" : kind === "pls" ? "pls_" : "top_") + l.id])}</div>
      <div class="lb"><div class="n">${rs.length}</div><div class="m">${pmMoney(pmSum(rs, money))}</div>${st}</div></button>`);
    b.addEventListener("click", () => { PmUi[kind].quick = PmUi[kind].quick === key ? "" : key; pmRerender(); });
    wrap.appendChild(b);
  }
  return wrap;
}

/* Open PRs by buyer — each dot is one PR at its value (log scale), coloured by step. */
function pmPrDotPlot(rows) {
  const panel = el(`<div class="pmx-panel"><h3>Open PRs by buyer${pmInfo(PM_INFO.dotPlot)}</h3>
    <div class="sub">Each dot is one PR at its current total cost · hover for details, click to open it below</div></div>`);
  const lanes = PM_PR_LANES.filter((l) => rows.some((r) => r.lane === l.id));
  panel.appendChild(el(`<div class="pmx-legend">${lanes.map((l) => `<span><i class="pmx-dot" style="background:${l.color}"></i>${esc(l.label)}</span>`).join("")}
    <span><i class="pmx-dot" style="border:1.5px solid var(--ax-muted)"></i>No cost yet</span></div>`));
  if (!rows.length) { panel.appendChild(el(`<div class="pmx-empty">No open PRs in this view.</div>`)); return panel; }
  const by = {};
  for (const r of rows) (by[r.poc] = by[r.poc] || []).push(r);
  const names = Object.keys(by).sort((a, b) => pmSum(by[b], "cost") - pmSum(by[a], "cost"));
  const W = 640, L = 120, R = 92, ZW = 30, top = 8, DR = 5.5, GAP = 2 * DR + 2;   // GAP = min centre distance (no overlap)
  const max = Math.max(1e3, ...rows.map((r) => r.cost));
  const lo = 3, hi = Math.max(4, Math.ceil(Math.log10(max)));
  const x0 = L + ZW + 22, x1 = W - R - 8;
  const X = (v) => x0 + (Math.log10(Math.max(v, 1e3)) - lo) / (hi - lo) * (x1 - x0);
  // Beeswarm: each dot takes the nearest vertical spot (0, ±3, ±6 …) where it touches no other dot;
  // a buyer row grows taller when it needs more room.
  const placed = names.map((n) => {
    const pts = [];
    for (const r of by[n].slice().sort((a, b) => a.cost - b.cost)) {
      const x = r.cost > 0 ? X(r.cost) : L + ZW / 2;
      let dy = 0;
      for (let s = 0; s < 200; s++) {
        dy = s === 0 ? 0 : (s % 2 ? -1 : 1) * Math.ceil(s / 2) * 3;
        if (pts.every((p) => (p.x - x) ** 2 + (p.dy - dy) ** 2 >= GAP * GAP)) break;
      }
      pts.push({ r, x, dy });
    }
    const spread = Math.max(0, ...pts.map((p) => Math.abs(p.dy)));
    return { n, pts, h: Math.max(30, 2 * spread + 2 * DR + 12) };
  });
  const H = top + placed.reduce((s, p) => s + p.h, 0) + 24;
  let svg = `<svg class="pmx-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Open PRs by buyer and value">`;
  for (let p = lo; p <= hi; p++) {
    const x = X(Math.pow(10, p));
    svg += `<line class="gl" x1="${x}" x2="${x}" y1="${top}" y2="${H - 22}"/><text class="ax" x="${x}" y="${H - 8}" text-anchor="middle">${pmMoney(Math.pow(10, p))}</text>`;
  }
  svg += `<text class="ax" x="${L + ZW / 2}" y="${H - 8}" text-anchor="middle">$0</text>`;
  let yAt = top;
  for (const { n, pts, h } of placed) {
    const cy = yAt + h / 2; yAt += h;
    svg += `<line class="gl" x1="${L}" x2="${x1}" y1="${cy}" y2="${cy}" stroke-dasharray="2 3"/>`;
    svg += `<text class="nm" x="${L - 8}" y="${cy + 4}" text-anchor="end">${esc(n.length > 18 ? pmShortName(n) : n)}</text>`;
    for (const { r, x, dy } of pts) {
      const lane = PM_PR_LANES.find((l) => l.id === r.lane);
      const tip = `<b>${esc(r.num)}</b> · ${esc(r.title)}<br>${esc(r.status)} · ${pmMoney(r.cost, true)}${r.flags.length ? "<br>" + r.flags.map((f) => esc(f.text)).join("<br>") : ""}`;
      svg += `<circle data-num="${esc(r.num)}" data-tip="${esc(tip)}" class="${r.cost > 0 ? "" : "zero"}" cx="${x.toFixed(1)}" cy="${(cy + dy).toFixed(1)}" r="${DR}" fill="${lane.color}"/>`;
    }
    svg += `<text x="${W - 4}" y="${cy + 4}" text-anchor="end"><tspan font-weight="700" fill="currentColor">${by[n].length}</tspan> · ${pmMoney(pmSum(by[n], "cost"))}</text>`;
  }
  svg += `</svg>`;
  const host = el(`<div>${svg}</div>`);
  host.querySelectorAll("circle").forEach((c) => c.addEventListener("click", () => pmOpenRow("proc", c.getAttribute("data-num"))));
  panel.appendChild(host);
  return panel;
}

/* Open TOPs by owner — stacked by how long since delivery; $ at the end. */
function pmTopBars(rows) {
  const panel = el(`<div class="pmx-panel"><h3>Open TOPs by owner${pmInfo(PM_INFO.topBars)}</h3>
    <div class="sub">Count of open TOP packages by days out for signature · property value at right</div>
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
  const panel = el(`<div class="pmx-panel pmx-act"><h3>Next ${PM_SOON_DAYS} days${pmInfo(PM_INFO.next7)}</h3><div class="sub">Click an item to open it in the table</div>
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
  const noTop = D.noTop.slice().sort((a, b) => parseInt(a.num, 10) - parseInt(b.num, 10));
  const panel = el(`<div class="pmx-panel pmx-act"><h3>TOP backlog${pmInfo(PM_INFO.backlog)}</h3><div class="sub">TOP packages with the government, by days out for signature</div>
    <div class="pmx-ages">${tile("age:a15", "Within 15 days", by("a15"), "#3987e5")}${tile("age:a30", "16–30 days", by("a30"), "#1c5cab")}
      ${tile("age:a31", "More than 30 days", by("a31"), "#c62828", true)}${by("unk").length ? tile("age:unk", PM_AGE_UNK.label, by("unk"), PM_AGE_UNK.color) : ""}</div>
    <h4><span>Oldest open TOPs</span><span>${oldest.length}</span></h4>${pmActList("prop", oldest, () => null, (r) => `${r.age != null ? r.age + "d" : "date unknown"} · ${pmMoney(r.value)}`, "None.")}
    <h4><span title="PRs with TOP Required = Yes and no PMCT in the Linked Request List">TOP required — no PMCT linked</span><span>${noTop.length}</span></h4>
    ${noTop.length ? `<ul>${noTop.slice(0, 8).map((p) => `<li data-pr="${esc(p.num)}"><span class="w">PR ${esc(p.num)}</span><span class="t" title="${esc(p.title)}">${esc(pmShortName(p.poc))} · ${esc(p.title)}</span><span class="d">${esc(p.status)}</span></li>`).join("")}</ul>${noTop.length > 8 ? `<div class="none">+${noTop.length - 8} more — see Procurement</div>` : ""}` : `<div class="none">Every PR that needs a TOP has a linked PMCT.</div>`}
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
    { k: "cost", l: "Total Cost/Value", num: true }, { k: "statusSince", l: "In status" }, { k: "rdd", l: "RDD" }, { k: "next", l: "Next due" },
    { k: "latest", l: "Latest update" }, { k: "flags", l: "Attention" },
  ] : [
    { k: "num", l: "PR" }, { k: "title", l: "Title" }, { k: "poc", l: "Buyer" }, { k: "status", l: "Final status" },
    { k: "cost", l: "Total cost", num: true }, { k: "approved", l: "Approved", num: true }, { k: "poDate", l: "PO" }, { k: "delivDate", l: "Delivered" },
    { k: "closedDate", l: "Closed" }, { k: "pmcts", l: "PMCT" }, { k: "fix", l: "Record fixes" },
  ];
  if (kind === "pls") return isActive ? [
    { k: "num", l: "PLS" }, { k: "title", l: "Team / event" }, { k: "dest", l: "Destination" }, { k: "start", l: "Travel dates" },
    { k: "travelers", l: "Travelers", num: true }, { k: "poc", l: "TTI POC" }, { k: "lane", l: "Step / ATLAS status" }, { k: "cost", l: "Total cost", num: true },
    { k: "statusSince", l: "In status" }, { k: "flags", l: "Attention" },
  ] : [
    { k: "num", l: "PLS" }, { k: "title", l: "Team / event" }, { k: "dest", l: "Destination" }, { k: "start", l: "Travel dates" },
    { k: "poc", l: "TTI POC" }, { k: "status", l: "Final status" }, { k: "cost", l: "Total cost", num: true },
    { k: "closedDate", l: "Closed" }, { k: "fix", l: "Record fixes" },
  ];
  return isActive ? [
    { k: "num", l: "PMCT" }, { k: "title", l: "TOP / title" }, { k: "source", l: "From" }, { k: "poc", l: "Owner" }, { k: "country", l: "Country" },
    { k: "lane", l: "Step / ATLAS status" }, { k: "value", l: "Property value", num: true }, { k: "sigSent", l: "Sent for signature" }, { k: "age", l: "Days out", num: true },
    { k: "latest", l: "Latest update" }, { k: "flags", l: "Attention" },
  ] : [
    { k: "num", l: "PMCT" }, { k: "title", l: "TOP / title" }, { k: "source", l: "From" }, { k: "poc", l: "Owner" }, { k: "country", l: "Country" },
    { k: "status", l: "Final status" }, { k: "value", l: "Property value", num: true }, { k: "sigSent", l: "Sent for signature" }, { k: "sigBack", l: "Signed TOP back" },
    { k: "sigDays", l: "Days out", num: true }, { k: "closedDate", l: "Closed" },
    { k: "fix", l: "Record fixes" },
  ];
}
function pmCell(kind, r, c, today) {
  const lanes = pmLanesFor(kind);
  switch (c.k) {
    case "dest": return `<td>${esc(r.country)}${r.city ? `<br><small style="color:var(--ax-muted)">${esc(r.city)}</small>` : ""}</td>`;
    case "start": {
      if (!r.start) return `<td></td>`;
      const when = r.phase === "upcoming" ? `in ${pmPlural(pmDays(today, r.start), "day")}` : r.phase === "now" ? "underway" : "";
      return `<td style="white-space:nowrap">${esc(pmFmt(r.start))} – ${esc(pmFmt(r.end))}${!r.closed && when ? `<br><small style="color:var(--ax-muted)">${when}</small>` : ""}</td>`;
    }
    case "travelers": return `<td class="num">${r.travelers || ""}</td>`;
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
    case "sigDays": return `<td class="num">${r.sigDays != null ? r.sigDays : ""}</td>`;
    case "pmcts": return `<td>${r.pmcts.map((t) => esc(t.num)).join(", ")}</td>`;
    case "fix": return `<td>${r.flags.filter((f) => f.fix).map((f) => `<span class="pmx-pill ${f.lvl}">${esc(f.text)}</span>`).join("")}</td>`;
    default: { const v = r[c.k]; return `<td>${v instanceof Date ? pmFmt(v) : esc(v == null ? "" : v)}</td>`; }
  }
}
function pmTable(kind, rows, isActive) {
  const ui = PmUi[kind];
  const cols = pmCols(kind, isActive).filter((c) => PM_VIEW_LOCKED.indexOf(c.k) !== -1 || pmShow(kind, "c:" + c.k));
  const today = pmToday();
  if (!rows.length) return el(`<div class="pmx-empty">Nothing matches the filters.</div>`);
  const head = cols.map((c) => `<th data-k="${c.k}" class="${c.num ? "num" : ""}">${esc(c.l)}${ui.sort.k === c.k ? (ui.sort.d > 0 ? " ▲" : " ▼") : ""}</th>`).join("");
  const body = rows.map((r) => {
    const open = ui.open.has(r.num);
    return `<tr class="row ${open ? "open" : ""}" data-num="${esc(r.num)}">${cols.map((c) => pmCell(kind, r, c, today)).join("")}</tr>` +
      (open ? `<tr class="pmx-det"><td colspan="${cols.length}">${kind === "proc" ? pmPrDetail(r) : kind === "pls" ? pmPlsDetail(r) : pmTopDetail(r)}</td></tr>` : "");
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
      ["TOP required", r.topReq ? "Yes" : "No"], ["PMCT", links || (r.topReq ? '<span style="color:var(--ax-amber)">None linked</span>' : "")],
      ["Red flag", r.redFlag ? `<span style="color:var(--ax-red)">${esc(r.redFlagNote || "Yes")}</span>` : ""]])}</div>
    <div><h5>Milestones</h5>${pmKv([["Submitted", d(r.submitted)], ["Compliance approved", d(r.complianceApproved)], ["Estimate due", d(r.estDue)],
      ["Estimate submitted", d(r.estSubmitted)], ["CT > $100K approved", d(r.ct100k)], ["Estimate approved", r.estApproved ? `${d(r.estApproved)}${r.approved ? " · " + pmMoney(r.approved, true) : ""}` : ""],
      ["PO due", d(r.poDue)], ["PO issued", r.poDate ? `${d(r.poDate)}${r.poCount > 1 ? ` (first of ${r.poCount} PO Issued entries)` : ""}` : (r.poExpected ? '<span style="color:var(--ax-amber)">No PO Issued entry</span>' : "")], ["Delivered", d(r.delivDate)], ["RDD", d(r.rdd)], ["Closed", r.closed ? d(r.closedDate) : ""]])}</div>
    <div><h5>Recent updates</h5>${pmNotesHtml(r)}</div></div>`;
}
function pmTopDetail(r) {
  const d = (x) => x ? esc(pmFmt(x, true)) : "";
  const srcLinks = r.srcPr.map((n) => `<a href="#" data-goto="proc:${esc(n)}">PR ${esc(n)}</a>`)
    .concat(r.srcLinks.filter((s) => /^SRF/.test(s)).map(esc)).join(", ");
  const att = r.att.slice(-6).reverse();
  return `<div class="pmx-dg">
    <div><h5>Transfer</h5>${pmKv([["WMTR", esc(r.wmtr)], ["Source request", srcLinks], ["Owner", esc(r.poc)], ["Destination", esc(r.country)],
      ["Property value", r.value ? pmMoney(r.value, true) : '<span style="color:var(--ax-amber)">Not recorded</span>'], ["TOP comments", esc(r.topComments)],
      ["Red flag", r.redFlag ? `<span style="color:var(--ax-red)">${esc(r.redFlagNote || "Yes")}</span>` : ""]])}</div>
    <div><h5>Milestones & documents</h5>${pmKv([["Submitted", d(r.submitted)],
      ["Sent for signature", r.sigSent ? d(r.sigSent) : (r.lane === "delivered" || r.closed ? '<span style="color:var(--ax-amber)">No Activity entry</span>' : "")],
      ["Signed TOP back", r.sigBack ? d(r.sigBack) : (r.closed && !/^cancel/i.test(r.status) ? '<span style="color:var(--ax-amber)">No Activity entry</span>' : "")],
      ["Days out for signature", r.age != null ? String(r.age) : r.sigDays != null ? String(r.sigDays) : ""], ["Closed", r.closed ? d(r.closedDate) : ""]])}
      ${att.length ? `<ul class="pmx-notes" style="margin-top:8px">${att.map((a) => `<li><b>${esc(a.type || "Attachment")}</b>${a.note ? " · " + esc(a.note) : ""}<br><span style="color:var(--ax-muted)">${a.at ? pmFmt(a.at, true) : ""} ${esc(a.by)}</span></li>`).join("")}</ul>` : ""}</div>
    <div><h5>Recent updates</h5>${pmNotesHtml(r)}</div></div>`;
}

function pmPlsDetail(r) {
  const d = (x) => x ? esc(pmFmt(x, true)) : "";
  const links = r.links.map((l) => `${esc(l.type)} ${esc(l.num)}${l.status ? ` (${esc(l.status)})` : ""}`).join("<br>");
  const svcs = r.services.map((s) => `${esc(s.name)} ${s.n}`).join(" · ");
  return `<div class="pmx-dg">
    <div><h5>Request</h5>${pmKv([["PLS", esc(r.wmtr)], ["DTR / IR", esc(r.dtr)], ["Type of travel", esc(r.travelType)], ["Program", esc(r.program)], ["CLIN", esc(r.clin)],
      ["CT requestor", esc(r.requestor)], ["CT project manager", esc(r.ctpm)], ["TTI POC", esc(r.poc)], ["Alternate", esc(r.alt)],
      ["Red flag", r.redFlag ? `<span style="color:var(--ax-red)">${esc(r.redFlagNote || "Yes")}</span>` : ""]])}
      ${r.purpose ? `<div style="font-size:12px;color:var(--ax-ink2);margin-top:6px">${esc(r.purpose)}</div>` : ""}</div>
    <div><h5>Milestones</h5>${pmKv([["Submitted", d(r.submitted)], ["Program review approved", d(r.programApproved)],
      ["Estimate approved", r.estApproved ? `${d(r.estApproved)}${r.approved ? " · " + pmMoney(r.approved, true) : ""}` : ""],
      ["Trip", r.start ? `${d(r.start)} – ${d(r.end)}` : ""], ["Closed", r.closed ? d(r.closedDate) : ""]])}</div>
    <div><h5>Travel & services</h5>${pmKv([["Destination", esc(r.dest)], ["Travelers", r.travelers ? String(r.travelers) : ""], ["Services booked", svcs],
      ["Total cost", r.cost ? pmMoney(r.cost, true) : ""], ["Linked requests", links]])}</div></div>`;
}

function pmExportXlsx(kind, rows, isActive) {
  const isPr = kind === "proc";
  const f = (d) => d instanceof Date ? xtIso(d) : "";
  if (kind === "pls") {
    const head = ["PLS", "Team / event", "Country", "City", "Start", "End", "Travelers", "TTI POC", "Step", "ATLAS status", "Total cost", "Status since",
      "Estimate approved", "Closed", "Attention"];
    const aoa = [head].concat(rows.map((r) => [r.wmtr, r.title, r.country, r.city, f(r.start), f(r.end), r.travelers || "", r.poc,
      (PM_PLS_LANES.find((l) => l.id === r.lane) || {}).label, r.status, r.cost || "", f(r.statusSince),
      f(r.estApproved), f(r.closedDate), r.flags.map((x) => x.text).join("; ")]));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = head.map((h) => ({ wch: /Team|Attention/.test(h) ? 44 : /^PLS$/.test(h) ? 24 : 14 }));
    XLSX.utils.book_append_sheet(wb, ws, isActive ? "Active PLS" : "Closed PLS");
    pmrDownloadXlsxB64(XLSX.write(wb, { type: "base64", bookType: "xlsx" }), `PLS_${isActive ? "Active" : "Closed"}_${fileStamp()}.xlsx`);
    return;
  }
  const head = isPr
    ? ["WMTR", "Title", "Buyer", "Step", "ATLAS status", "Total cost", "Approved", "Status since", "RDD", "Estimate due", "PO due", "PO issued", "Delivered", "Closed",
       "TOP required", "PMCT", "Latest update date", "Latest update", "Attention"]
    : ["WMTR", "Title", "From", "Owner", "Country", "Step", "ATLAS status", "Property value", "Sent for signature", "Signed TOP back", "Days out",
       "Closed", "Latest update date", "Latest update", "Attention"];
  const aoa = [head];
  for (const r of rows) {
    const att = r.flags.map((x) => x.text).join("; ");
    const lu = r.latest ? [f(r.latest.date), r.latest.note || r.latest.stage] : ["", ""];
    if (isPr) aoa.push([r.wmtr, r.title, r.poc, (PM_PR_LANES.find((l) => l.id === r.lane) || {}).label, r.status, r.cost || "", r.approved || "", f(r.statusSince), f(r.rdd),
      f(r.estDue), f(r.poDue), f(r.poDate), f(r.delivDate), f(r.closedDate), r.topReq ? "Yes" : "No", r.pmcts.map((t) => t.num).join(", ")].concat(lu, [att]));
    else aoa.push([r.wmtr, r.title, r.source, r.poc, r.country, (PM_TOP_LANES.find((l) => l.id === r.lane) || {}).label, r.status, r.value || "", f(r.sigSent),
      f(r.sigBack), r.age != null ? r.age : r.sigDays != null ? r.sigDays : "", f(r.closedDate)].concat(lu, [att]));
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
  { id: "pls", name: "Personnel Logistics Services", hint: "e.g. Visa delays, big events coming up" },
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
  if (ui.poc) p.push(`${isPr ? "Buyer" : kind === "pls" ? "TTI POC" : "Owner"} ${ui.poc}`);
  if (norm(ui.q)) p.push(`search "${norm(ui.q)}"`);
  if (ui.attn) p.push("needs attention");
  const k = ui.quick;
  if (k) {
    const lane = k.startsWith("lane:") && pmLanesFor(kind).find((l) => l.id === k.slice(5));
    const age = k.startsWith("age:") && PM_AGE.find((a) => a.id === k.slice(4));
    const names = { big: isPr ? "over $100K" : "$200K and over", attn: "needs attention", estdue: "estimates due", podue: "POs expected", rdd: "past RDD", flag: "red flags",
      trips: `trips in next ${PmUi.pls.tripDays} days`, now: "traveling now", ended: "trip ended" };
    p.push(lane ? lane.label : age ? age.label : names[k] || k);
  }
  return p.join(", ");
}

function pmSlideModel(D) {
  const today = pmToday();
  const useF = PmUi.slideFiltered;
  const pool = (all, kind) => {
    const a = all.filter((r) => !r.closed);
    return useF ? pmFilter(a, Object.assign({}, PmUi[kind], { sort: { k: "", d: 1 } }), kind) : a;
  };
  const prPool = pool(D.prs, "proc");
  const prs = prPool.filter((r) => r.lane !== "draft");
  const tops = pool(D.tops, "prop").filter((r) => r.lane !== "draft");
  const pls = pool(D.pls, "pls").filter((r) => r.lane !== "draft");
  const pd = pmFilterDesc("proc"), td = pmFilterDesc("prop");
  const filterNote = useF && (pd || td) ? `Filtered: Procurement ${pd || "none"}; Property ${td || "none"}` : "";
  const plsModel = () => {
    const dtra = pls.filter((r) => r.lane === "approval");
    const tripDays = PmUi.pls.tripDays;
    const trips = pls.filter((r) => pmTripSoon(r, today, tripDays));
    const now = pls.filter((r) => r.phase === "now");
    const attn = pls.filter((r) => r.flags.length);
    const soon = pls.filter((r) => r.start && pmDays(today, r.start) >= 0 && pmDays(today, r.start) <= PM_PLS_SOON_DAYS).sort((a, b) => a.start - b.start);
    return {
      n: pls.length, value: pmSum(pls, "cost"),
      tiles: [
        { label: `Trips in next ${tripDays} days`, n: trips.length, sub: pmPlural(pmSum(trips, "travelers"), "traveler") },
        { label: "Traveling now", n: now.length, sub: now.length ? pmPlural(pmSum(now, "travelers"), "traveler") : "" },
        { label: "Estimate with DTRA", n: dtra.length, sub: "" },
        { label: "Need attention", n: attn.length, sub: "", red: attn.some((r) => r.flags.some((f) => f.lvl === "red")) },
      ],
      soon,                                            // records; pmSlidePlan words them to fit
    };
  };
  // Chart groups: the 7 biggest by count, the rest folded into one "Others" bar (never dropped).
  const groupBy = (rows) => {
    const g = {};
    for (const r of rows) (g[r.poc] = g[r.poc] || []).push(r);
    const names = Object.keys(g).sort((a, b) => g[b].length - g[a].length);
    const top = names.slice(0, names.length > 8 ? 7 : 8).map((n) => ({ name: n, label: pmShortName(n), rs: g[n] }));
    const rest = names.slice(top.length);
    if (rest.length) top.push({ name: rest.join(", "), label: `${rest.length} others`, rs: [].concat(...rest.map((n) => g[n])), others: rest });
    return top;
  };
  const buyers = groupBy(prs), owners = groupBy(tops);
  const prLanes = PM_PR_LANES.filter((l) => l.id !== "draft");
  const due = (r, d) => ({ r, d, late: pmDays(today, d) < 0 });
  const est = prs.filter((r) => r.estDue && pmDays(today, r.estDue) <= PM_SOON_DAYS).sort((a, b) => a.estDue - b.estDue).map((r) => due(r, r.estDue));
  const po = prs.filter((r) => r.poDue && pmDays(today, r.poDue) <= PM_SOON_DAYS).sort((a, b) => a.poDue - b.poDue).map((r) => due(r, r.poDue));
  const bucket = (b) => tops.filter((r) => r.bucket === b);
  return {
    date: pmFmt(today, true), filterNote, today,
    pr: {
      n: prs.length, value: pmSum(prs, "cost"), drafts: prPool.filter((r) => r.lane === "draft").length,
      groups: buyers,
      cats: buyers.map((g) => `${g.label}\n${pmMoney(pmSum(g.rs, "cost"))}`),
      series: prLanes.map((l) => ({ name: l.label, color: l.color, values: buyers.map((g) => g.rs.filter((r) => r.lane === l.id).length) })),
      est, po,
    },
    top: {
      n: tops.length, value: pmSum(tops, "value"),
      groups: owners,
      out: tops.filter((r) => r.lane === "delivered").sort((a, b) => (b.age == null ? -1 : b.age) - (a.age == null ? -1 : a.age)),
      cats: owners.map((g) => `${g.label}  ${pmMoney(pmSum(g.rs, "value"))}`),
      series: pmAgesFor(tops).map((a) => ({ name: a.label, color: a.color, values: owners.map((g) => g.rs.filter((r) => r.bucket === a.id).length) })),
      tiles: [
        { label: "Within 15 days", rs: bucket("a15") }, { label: "16–30 days", rs: bucket("a30") },
        { label: "More than 30 days", rs: bucket("a31"), red: true },
      ].concat(bucket("unk").length ? [{ label: PM_AGE_UNK.label, rs: bucket("unk") }] : [])
        .map((t) => ({ label: t.label, n: t.rs.length, value: pmSum(t.rs, "value"), red: t.red })),
    },
    pls: D.plsSlot ? plsModel() : null,                // no PLS UDQ loaded = notes only
  };
}

function pmSlideCard(D) {
  const S = pmSlideGet();
  const card = el(`<section class="copx-card">
    <div class="copx-hd"><h2>Weekly update slide${pmInfo(PM_INFO.slide)}</h2><span class="n">Procurement, Property and PLS fill from the UDQs · type notes for any quadrant below · one bullet per line</span>
      <div class="acts"><button class="copx-btn green" id="pmPptx" type="button">Download PowerPoint</button></div></div>
    <div class="copx-rule"></div>
    <label class="copx-chk" style="margin:0 0 10px"><input type="checkbox" id="pmSFilt" ${PmUi.slideFiltered ? "checked" : ""}> Use the dashboard filters
      <span style="color:var(--ax-muted)">(Procurement: ${esc(pmFilterDesc("proc") || "none")} · Property: ${esc(pmFilterDesc("prop") || "none")})</span></label>
    <div id="pmSlidePrev"></div>
    <div class="pmx-sedit">
      <div><label for="pmSTitle">Slide title</label><input id="pmSTitle" value="${esc(S.title)}"></div>
      <div><label for="pmSSub">Contract / subtitle</label><input id="pmSSub" value="${esc(S.sub)}"></div>
      ${PM_QUADS.map((q) => `<div><label for="pmN_${q.id}">${esc(q.name)} — notes</label><textarea id="pmN_${q.id}" placeholder="${esc(q.hint)}">${esc(S.notes[q.id])}</textarea>
        <div class="hint">${q.id === "prog" ? "Fills this quadrant." : q.id === "proc" ? "Shown beside the estimates and POs." : "Shown under the automatic numbers."} Saved in this browser.</div></div>`).join("")}
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

/* ---- Slide plan: one layout (inches / points on a 13.333 x 7.5 slide) drawn by both the preview and the .pptx.
   Lists never say "+N more": a list that doesn't fit at a readable size (10 pt minimum) is shown grouped
   (by buyer / by country), then as a one-line count. The full lists always go in the slide notes. ---- */
const PMS = { W: 13.333, H: 7.5, NAVY: "1E2A4A", INK: "1F2D3D", MUTED: "5A6778", SOFT: "8A94A3", CARD: "F4F6FA", LINE: "E1E6EE", RED: "C62828" };
const PMS_FS = [12, 11.5, 11, 10.5, 10];        // list / notes sizes tried, largest first
let _pmsCtx = null;
function pmsWidth(s, fs) {                       // inches, measured in Calibri (what PowerPoint wraps with)
  if (_pmsCtx === null) { try { _pmsCtx = document.createElement("canvas").getContext("2d") || false; } catch (e) { _pmsCtx = false; } }
  if (!_pmsCtx) return s.length * 0.5 * fs / 72;
  _pmsCtx.font = `${fs}pt Calibri, Carlito, "Segoe UI", sans-serif`;
  return _pmsCtx.measureText(s).width / 96;
}
function pmsLines(t, w, fs, bullet) {            // wrapped lines, word by word, with a 5% safety margin
  const avail = (w - (bullet ? 0.22 : 0.04)) * 0.95;
  let n = 0;
  for (const p of String(t).split("\n")) {
    let line = "", c = 1;
    for (const word of p.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (!line || pmsWidth(next, fs) <= avail) line = next; else { c++; line = word; }
    }
    n += c;
  }
  return n;
}
function pmsBlockH(head, items, w, fs, bullet) {
  let lines = 0, paras = 0;
  if (head) { lines += pmsLines(head, w, fs); paras++; }
  for (const t of items) { lines += pmsLines(t, w, fs, bullet); paras++; }
  return lines * fs * 1.2 / 72 + paras * 2 / 72;
}
/** First tier (full → grouped → one line) and largest size that fit height h; `cols` splits a tier's items into columns. */
function pmsFit(head, tiers, w, h, cols) {
  const build = (tier, fs) => {
    const n = tier.oneCol ? 1 : (tier.cols || cols || 1);
    const per = Math.max(1, Math.ceil(tier.items.length / n));
    const parts = [];
    for (let i = 0; i < n; i++) { const p = tier.items.slice(i * per, (i + 1) * per); if (p.length || !i) parts.push(p); }
    const cw = (w - (parts.length - 1) * 0.25) / parts.length;
    const hd = tier.head || head;
    const headH = hd ? pmsBlockH(hd, [], w, fs) : 0;
    const body = Math.max(...parts.map((p) => pmsBlockH(null, p, cw, fs, tier.bullet)));
    return { head: hd, parts, cw, fs, bullet: tier.bullet, muted: tier.muted, headH, h: headH + body };
  };
  let last = null;
  for (const t of tiers) for (const fs of PMS_FS) { last = build(t, fs); if (last.h <= h) return last; }
  return Object.assign(last, { over: true });
}

function pmSlidePlan(m, S) {
  const ops = [], warn = [], N = [];
  const today = m.today;
  const run = (text, o) => Object.assign({ text: String(text) }, o || {});
  const para = (runs, o) => Object.assign({ runs: Array.isArray(runs) ? runs : [runs] }, o || {});
  const text = (x, y, w, h, paras, o) => { ops.push(Object.assign({ t: "text", x, y, w, h, paras, fs: 11 }, o || {})); };
  const box = (x, y, w, h, fill, r, name) => ops.push({ t: "box", x, y, w, h, fill, line: PMS.LINE, r, name });
  const block = (x, y, f) => {
    if (f.head) text(x, y, f.parts.length * f.cw + (f.parts.length - 1) * 0.25, f.headH + 0.02, [para(run(f.head, { bold: true, color: PMS.NAVY }))], { fs: f.fs });
    f.parts.forEach((p, i) => text(x + i * (f.cw + 0.25), y + f.headH, f.cw, f.h - f.headH + 0.06,
      p.map((t) => para(run(t, f.muted ? { italic: true, color: PMS.SOFT } : {}), { bullet: f.bullet })), { fs: f.fs }));
  };
  const notesIn = (x, y, w, h, list, label) => {
    if (!list.length || h < 0.2) { if (list.length) warn.push(`${label} notes don't fit — shorten them.`); return; }
    const f = pmsFit(null, [{ items: list, bullet: true }], w, h);
    if (f.over) warn.push(`${label} notes are too long to fit at a readable size — shorten them.`);
    block(x, y, f);
  };
  /* lists (a function of the height it may use) above Jon's notes: notes keep their full size when they can,
     but never take more than half the space; lists drop to a grouped / one-line version to make room. */
  const stack = (b, y0, lists, notes, label) => {
    const A = b.y + b.h - y0;
    const want = notes.length ? pmsBlockH(null, notes, b.w, 10.5, true) + 0.12 : 0;   // + the gap above the notes
    const L = lists(Math.max(0.42, A - Math.min(want, A * 0.5)));
    L.draw(y0);
    notesIn(b.x, y0 + L.h + 0.1, b.w, b.y + b.h - (y0 + L.h + 0.1), notes, label);
  };
  const short = (s, n) => s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
  const late = (x) => pmDays(x.d, today);

  // title
  text(0.45, 0.2, 8.6, 0.55, [para(run(S.title, { bold: true, color: PMS.NAVY }))], { fs: 26, valign: "middle" });
  text(8.9, 0.24, 3.98, 0.5, [para(run(`${S.sub} · ${m.date}`, { color: PMS.MUTED }))], { fs: 13, align: "right", valign: "middle" });

  // quadrants: the left column (charts / lists) is wider; the top row is taller
  const X0 = 0.45, Y0 = 0.86, GAP = 0.22, WL = 6.95, WR = PMS.W - 2 * X0 - GAP - WL, HT = 3.5, HB = 7.33 - Y0 - GAP - HT;
  const frame = (x, y, w, h, name, headline) => {
    box(x, y, w, h, PMS.CARD, 0.08, `${name} card`);
    text(x + 0.2, y + 0.1, w * 0.6, 0.36, [para(run(name, { bold: true, color: PMS.NAVY }))], { fs: 15, valign: "middle" });
    if (headline) text(x + w * 0.42, y + 0.12, w * 0.58 - 0.2, 0.32, [para(run(headline, { color: PMS.MUTED }))], { fs: 12, align: "right", valign: "middle" });
    return { x: x + 0.2, y: y + 0.5, w: w - 0.4, h: h - 0.6 };
  };
  const tile = (x, y, w, h, n, sub, label, red) => {
    box(x, y, w, h, "FFFFFF", 0.06);
    text(x + 0.1, y + 0.02, w - 0.14, h - 0.04, [
      para([run(n, { bold: true, color: red ? PMS.RED : PMS.INK, size: 18 }), run(sub ? `  ${sub}` : "", { color: PMS.MUTED, size: 11 })]),
      para(run(label, { color: PMS.MUTED }))], { fs: 10.5, valign: "middle" });
  };

  // 1 · Procurement — buyer chart across the top, estimates | POs below, then Jon's notes
  let b = frame(X0, Y0, WL, HT, "Procurement", `${m.pr.n} open PRs · ${pmMoney(m.pr.value)}${m.pr.drafts ? ` · ${pmPlural(m.pr.drafts, "draft")} not counted` : ""}`);
  const CH = 1.45;
  ops.push({ t: "chart", dir: "col", x: b.x, y: b.y, w: b.w, h: CH, title: "Open PRs by buyer (count by step)", cats: m.pr.cats, series: m.pr.series });
  const dueTiers = (xs, noun) => {
    if (!xs.length) return [{ items: ["None"], muted: true }];
    const nl = xs.filter((x) => x.late).length;
    const by = {};
    for (const x of xs) (by[pmShortName(x.r.poc)] = by[pmShortName(x.r.poc)] || []).push(x);
    const keys = Object.keys(by).sort((a, c) => by[c].length - by[a].length);
    const lt = (k) => by[k].filter((x) => x.late).length;
    return [
      { items: xs.map((x) => `${x.r.num} · ${pmShortName(x.r.poc)} · ${x.late ? `${late(x)}d overdue` : pmFmt(x.d)}`), bullet: true },
      { items: keys.map((k) => `${k} — ${by[k].length}${lt(k) ? ` (${lt(k)} overdue)` : ""}`), bullet: true },
      { items: [`By buyer: ${keys.map((k) => `${k} ${by[k].length}${lt(k) ? ` (${lt(k)} late)` : ""}`).join(" · ")}`] },
      { items: [`${pmPlural(xs.length, noun)}${nl ? `, ${nl} overdue` : ""} — listed in the slide notes`] },
    ];
  };
  // Below the chart, split in half: estimates over POs on the left, Jon's notes on the right.
  // With no notes, estimates | POs use the full width side by side.
  const prCw = (b.w - 0.3) / 2, prY = b.y + CH + 0.12, prA = b.y + b.h - prY;
  const estHead = `Cost estimates due ≤ ${PM_SOON_DAYS} days (${m.pr.est.length})`, poHead = `POs expected ≤ ${PM_SOON_DAYS} days (${m.pr.po.length})`;
  const prNotes = pmBullets(S.notes.proc);
  if (prNotes.length) {
    const fit = (head, xs, noun, h) => pmsFit(head, dueTiers(xs, noun), prCw, h);
    const fp0 = fit(poHead, m.pr.po, "PO", prA / 2 - 0.05);                       // POs' fair share first,
    const fe = fit(estHead, m.pr.est, "estimate", prA - fp0.h - 0.1);              // estimates take what's left,
    const fp = fit(poHead, m.pr.po, "PO", prA - fe.h - 0.1);                       // then POs get the rest
    const fs = Math.min(fe.fs, fp.fs);
    block(b.x, prY, Object.assign(fe, { fs }));
    block(b.x, prY + fe.h + 0.1, Object.assign(fp, { fs }));
    notesIn(b.x + prCw + 0.3, prY, prCw, prA, prNotes, "Procurement");
  } else {
    const fe = pmsFit(estHead, dueTiers(m.pr.est, "estimate"), prCw, prA);
    const fp = pmsFit(poHead, dueTiers(m.pr.po, "PO"), prCw, prA);
    const fs = Math.min(fe.fs, fp.fs);
    block(b.x, prY, Object.assign(fe, { fs })); block(b.x + prCw + 0.3, prY, Object.assign(fp, { fs }));
  }

  // 2 · Property — owner chart + backlog tiles on top, Jon's notes in the lower half
  b = frame(X0 + WL + GAP, Y0, WR, HT, "Property", `${m.top.n} open TOPs · ${pmMoney(m.top.value)}`);
  const TH = b.h * 0.6, chw = b.w * 0.5;
  ops.push({ t: "chart", dir: "bar", x: b.x, y: b.y, w: chw, h: TH, title: "Open TOPs by owner", cats: m.top.cats, series: m.top.series });
  const rx = b.x + chw + 0.18, rw = b.w - chw - 0.18, tw = (rw - 0.1) / 2;
  const rows = Math.ceil(m.top.tiles.length / 2), th = Math.min(0.75, (TH - 0.3 - (rows - 1) * 0.1) / rows);
  text(rx, b.y, rw, 0.26, [para(run("TOP backlog (days out)", { bold: true, color: PMS.NAVY }))], { fs: 11 });
  m.top.tiles.forEach((t, i) => tile(rx + (i % 2) * (tw + 0.1), b.y + 0.3 + Math.floor(i / 2) * (th + 0.1), tw, th, t.n, pmMoney(t.value), t.label, t.red && t.n));
  notesIn(b.x, b.y + TH + 0.15, b.w, b.h - TH - 0.15, pmBullets(S.notes.prop), "Property");

  // 3 · PLS — tiles across the top, trips starting soon, then Jon's notes
  b = frame(X0, Y0 + HT + GAP, WL, HB, "Personnel Logistics Services", m.pls ? `${m.pls.n} open PLS · ${pmMoney(m.pls.value)}` : "");
  if (m.pls) {
    const n = m.pls.tiles.length, ptw = (b.w - (n - 1) * 0.12) / n, pth = 0.6;
    m.pls.tiles.forEach((t, i) => tile(b.x + i * (ptw + 0.12), b.y, ptw, pth, t.n, t.sub, t.label, t.red));
    const soon = m.pls.soon;
    const tripTiers = () => {
      if (!soon.length) return [{ items: ["None"], muted: true }];
      const by = {};
      for (const r of soon) (by[r.country || "Unknown"] = by[r.country || "Unknown"] || []).push(r);
      const keys = Object.keys(by).sort((a, c) => by[a][0].start - by[c][0].start);
      const grp = keys.map((k) => `${k} — ${by[k].length} (from ${pmFmt(by[k][0].start)})`);
      return [
        { items: soon.map((r) => `${pmFmt(r.start)} · ${r.country} · ${r.num} ${short(r.title, 22)}`), bullet: true },
        { items: grp, bullet: true, cols: 3, head: `Trips starting ≤ ${PM_PLS_SOON_DAYS} days (${soon.length}) — by country` },
        { items: [`${keys.map((k) => `${k} ${by[k].length}`).join(" · ")} (${pmPlural(pmSum(soon, "travelers"), "traveler")})`], oneCol: true,
          head: `Trips starting ≤ ${PM_PLS_SOON_DAYS} days (${soon.length}) — by country` },
        { items: [`${pmPlural(soon.length, "trip")}, ${pmPlural(pmSum(soon, "travelers"), "traveler")}, ${Object.keys(by).length} ${Object.keys(by).length === 1 ? "country" : "countries"} — listed in the slide notes`], oneCol: true },
      ];
    };
    stack(b, b.y + pth + 0.12, (h) => {
      const f = pmsFit(`Trips starting ≤ ${PM_PLS_SOON_DAYS} days (${soon.length})`, tripTiers(), b.w, h, 2);
      return { h: f.h, draw: (y) => block(b.x, y, f) };
    }, pmBullets(S.notes.pls), "PLS");
  } else {
    const pn = pmBullets(S.notes.pls);
    if (pn.length) notesIn(b.x, b.y, b.w, b.h, pn, "PLS");
    else text(b.x, b.y, b.w, 0.3, [para(run("Nothing to report this week.", { italic: true, color: PMS.SOFT }))], { fs: 12 });
  }

  // 4 · Significant Program Actions — Jon's notes
  b = frame(X0 + WL + GAP, Y0 + HT + GAP, WR, HB, "Significant Program Actions", "");
  const gn = pmBullets(S.notes.prog);
  if (gn.length) notesIn(b.x, b.y, b.w, b.h, gn, "Significant Program Actions");
  else text(b.x, b.y, b.w, 0.3, [para(run("Nothing to report this week.", { italic: true, color: PMS.SOFT }))], { fs: 12 });

  // slide notes — every request behind the numbers
  const dl = (x) => `${x.r.num} · ${x.r.title} · ${x.r.poc} · ${x.late ? `${late(x)} days overdue (due ${pmFmt(x.d, true)})` : `due ${pmFmt(x.d, true)}`}`;
  N.push(`PROCUREMENT — ${m.pr.n} open PRs, ${pmMoney(m.pr.value)}`);
  for (const g of m.pr.groups) if (g.others) N.push(`"${g.label}" bar = ${g.name}`);
  N.push(`Cost estimates due within ${PM_SOON_DAYS} days (${m.pr.est.length}):`, ...(m.pr.est.length ? m.pr.est.map((x) => "• " + dl(x)) : ["• None"]));
  N.push(`POs expected within ${PM_SOON_DAYS} days (${m.pr.po.length}):`, ...(m.pr.po.length ? m.pr.po.map((x) => "• " + dl(x)) : ["• None"]));
  N.push("", `PROPERTY — ${m.top.n} open TOPs, ${pmMoney(m.top.value)}`);
  for (const g of m.top.groups) if (g.others) N.push(`"${g.label}" bar = ${g.name}`);
  N.push(`Out for signature (${m.top.out.length}), longest first:`, ...(m.top.out.length ? m.top.out.map((r) =>
    `• ${r.num} · ${r.title} · ${r.poc} · ${r.age != null ? `${r.age} days out` : "sent date unknown"} · ${pmMoney(r.value, true)}`) : ["• None"]));
  if (m.pls) {
    N.push("", `PLS — ${m.pls.n} open PLS, ${pmMoney(m.pls.value)}`, `Trips starting within ${PM_PLS_SOON_DAYS} days (${m.pls.soon.length}):`,
      ...(m.pls.soon.length ? m.pls.soon.map((r) => `• ${pmFmt(r.start, true)} – ${pmFmt(r.end, true)} · ${r.dest} · ${r.num} ${r.title} · ${pmPlural(r.travelers, "traveler")} · ${r.poc} · ${r.status}`) : ["• None"]));
  }
  if (m.filterNote) N.push("", m.filterNote);
  return { ops, warn, notes: N.join("\n") };
}

/* Preview: the plan drawn as HTML (same positions and sizes as the .pptx). */
function pmSlideHtml(m, S) {
  const P = pmSlidePlan(m, S);
  const pct = (v, of) => `${(v / of * 100).toFixed(3)}%`;
  const at = (o) => `left:${pct(o.x, PMS.W)};top:${pct(o.y, PMS.H)};width:${pct(o.w, PMS.W)};height:${pct(o.h, PMS.H)}`;
  const pt = (n) => `${(n / 72 / PMS.W * 100).toFixed(3)}cqw`;
  const col = (c) => "#" + c;
  const runH = (r) => `<span style="${r.bold ? "font-weight:700;" : ""}${r.italic ? "font-style:italic;" : ""}${r.color ? `color:${col(r.color)};` : ""}${r.size ? `font-size:${pt(r.size)};` : ""}">${esc(r.text)}</span>`;
  const chartH = (o) => {
    const tot = o.cats.map((c, i) => o.series.reduce((s, x) => s + x.values[i], 0));
    const max = Math.max(1, ...tot);
    const used = o.series.filter((x) => x.values.some((v) => v));
    const lg = (h) => `<div class="lg ${h ? "h" : ""}" style="font-size:${pt(10)}">${used.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>`;
    if (!o.cats.length) return `<div class="t" style="font-size:${pt(11)}">${esc(o.title)}</div><div style="font-size:${pt(11)};font-style:italic;color:#5a6778">None open.</div>`;
    if (o.dir === "col") return `<div class="t" style="font-size:${pt(11)}">${esc(o.title)}</div><div class="pl"><div class="cols">${o.cats.map((c, i) => `<div class="c">
        <div class="stk" style="justify-content:flex-start">${o.series.map((s) => s.values[i] ? `<div class="sg" style="height:${(s.values[i] / max * 100).toFixed(1)}%;background:${s.color};font-size:${pt(10)}">${s.values[i]}</div>` : "").join("")}</div>
        <div class="cl" style="font-size:${pt(10)}">${esc(c)}</div></div>`).join("")}</div>${lg(false)}</div>`;
    return `<div class="t" style="font-size:${pt(11)}">${esc(o.title)}</div><div class="bars" style="font-size:${pt(10)}">${o.cats.map((c, i) => `<span>${esc(c)}</span><div class="tr">${o.series.map((s) => s.values[i]
      ? `<div class="sg" style="width:${(s.values[i] / max * 100).toFixed(1)}%;background:${s.color};font-size:${pt(10)}">${s.values[i]}</div>` : "").join("")}</div>`).join("")}</div>${lg(true)}`;
  };
  const html = P.ops.map((o) => {
    if (o.t === "box") return `<div class="o bx" style="${at(o)};background:${col(o.fill)};border-radius:${pt(o.r * 72)}"></div>`;
    if (o.t === "chart") return `<div class="o ch" style="${at(o)}">${chartH(o)}</div>`;
    const v = o.valign === "middle" ? "display:flex;flex-direction:column;justify-content:center;" : "";
    return `<div class="o tx" style="${at(o)};${v}font-size:${pt(o.fs)};text-align:${o.align || "left"};color:#${PMS.INK}">${o.paras.map((p) =>
      `<p class="${p.bullet ? "b" : ""}">${p.runs.map(runH).join("")}</p>`).join("")}</div>`;
  }).join("");
  return `<div class="pmx-slide">${html}</div>${P.warn.length ? `<div class="pmx-swarn">${P.warn.map(esc).join(" ")}</div>` : ""}`;
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
  const hex = (c) => c.replace("#", "").toUpperCase();
  const s = pptx.addSlide();
  s.background = { color: "FFFFFF" };
  const P = pmSlidePlan(m, S);                                       // same plan the preview draws
  for (const o of P.ops) {
    if (o.t === "box") {
      s.addShape(pptx.ShapeType.roundRect, { x: o.x, y: o.y, w: o.w, h: o.h, fill: { color: o.fill }, line: { color: o.line, width: 0.75 }, rectRadius: o.r, objectName: o.name });
    } else if (o.t === "text") {
      const runs = [];
      o.paras.forEach((p, pi) => p.runs.forEach((r, ri) => {
        const opt = { color: r.color || PMS.INK };
        if (r.bold) opt.bold = true;
        if (r.italic) opt.italic = true;
        if (r.size) opt.fontSize = r.size;
        if (ri === 0 && p.bullet) opt.bullet = { indent: 12 };
        if (ri === p.runs.length - 1 && pi < o.paras.length - 1) opt.breakLine = true;
        runs.push({ text: r.text, options: opt });
      }));
      s.addText(runs, { x: o.x, y: o.y, w: o.w, h: o.h, fontSize: o.fs, align: o.align || "left", valign: o.valign || "top", margin: 0, paraSpaceAfter: 2, isTextBox: true });
    } else if (o.t === "chart") {
      if (!o.cats.length) {
        s.addText(`${o.title}: none open.`, { x: o.x, y: o.y, w: o.w, h: 0.3, fontSize: 11, italic: true, color: PMS.MUTED, margin: 0, isTextBox: true });
        continue;
      }
      const used = o.series.filter((x) => x.values.some((v) => v));
      const col = o.dir === "col";
      s.addChart(pptx.ChartType.bar, used.map((x) => ({ name: x.name, labels: o.cats, values: x.values })), {
        x: o.x - 0.08, y: o.y - 0.06, w: o.w + 0.08, h: o.h + 0.06,
        barDir: col ? "col" : "bar", barGrouping: "stacked", barGapWidthPct: col ? 35 : 45, chartColors: used.map((x) => hex(x.color)),
        showTitle: true, title: o.title, titleFontSize: 11, titleColor: PMS.INK, titleFontFace: "Calibri",
        catAxisOrientation: col ? "minMax" : "maxMin", catAxisLabelFontSize: 10, catAxisLabelColor: PMS.INK, catAxisLabelFontFace: "Calibri", catAxisLineShow: false,
        valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" },
        showValue: true, dataLabelPosition: "ctr", dataLabelFontSize: 10, dataLabelColor: "FFFFFF", dataLabelFormatCode: "#;;", dataLabelFontFace: "Calibri",
        showLegend: true, legendPos: col ? "r" : "b", legendFontSize: 10, legendColor: PMS.MUTED, legendFontFace: "Calibri",
      });
    }
  }
  s.addNotes(P.notes);                                               // every request behind the numbers


  const name = `PM_Weekly_Update_${fileStamp()}.pptx`;
  await pptx.writeFile({ fileName: name });
  return name;
}

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { pmPrLane, pmTopLane, pmIsClosed, pmMoney, pmParsePr, pmParsePmct };
}
