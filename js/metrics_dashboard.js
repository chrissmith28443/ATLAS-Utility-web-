/* =========================================================================
   ATLAS Utility Web — metrics_dashboard.js

   The "drop a Metrics UDQ → see the picture" view.

   When a Metrics UDQ loads, app.renderDashboard() calls renderMetricsDashboard()
   here — the same way SRF and Property UDQs auto-populate their dashboards. It
   summarizes the Metrics-section data points (delivered SRFs, on-time rate, late
   deliveries, and breakdowns by destination / shipping mode / CTR program / cost
   / value) as KPI cards, inline SVG charts, and tables.

   Engine parity: every number here comes from pmrRun() in tools/pmr.js — the
   faithful port of services/pmr_service.run_pmr. The dashboard is a visual front
   end on that same computation, so the figures match the PMR export exactly. The
   PMR tool remains the place to export the full charted workbook or any single
   section; this view is the at-a-glance overview.

   Reporting window: defaults to "All time" (start/end = null → pmrRun ignores the
   date filter, every delivered WMTR is counted). Quick buttons and a custom
   start/end recompute and repaint in place, mirroring the PMR dialog's window
   choices (fiscal year starts Oct 1).

   No charting library is loaded (the app ships only SheetJS + JSZip), so the
   charts are hand-built SVG. Colors are pinned to the manifest palette below so
   they stay on-brand and easy to retheme in one place.
   ========================================================================= */

/* Manifest palette (mirrors css/app.css :root; pinned here because SVG
   presentation attributes don't reliably resolve CSS custom properties). */
const MX_COLORS = {
  accent: "#E8590C",      // cargo orange
  accentSoft: "#F6A06A",
  ink: "#16283C",         // manifest navy
  steel: "#5B6B7C",
  line: "#D4DAE0",
  green: "#1E7F4F",       // on-time / cleared
  amber: "#D8A200",       // warning tier on metric cards
  red: "#B00000",         // late / error
  track: "#E8ECEF",
};

/* Status → mini-viz color, matching the metric-card green/yellow/red scheme. */
const MX_STATUS_COLOR = { good: MX_COLORS.green, warn: MX_COLORS.amber, issue: MX_COLORS.red };
const MX_STATUS_LABEL = { good: "OK", warn: "Warning", issue: "Issue" };

/* Display metadata for the SRF metric cards, keyed by the Christmas Tree metric
   key (XT_ROLLUP_METRICS). `target` is the on-dashboard detail section to scroll
   to, or null when the full breakdown lives in another tool (PMR / ReqAtt).
   `noun` completes the "pass/total <noun>" subtitle. */
const MX_SRF_METRIC_META = {
  delivery: { title: "On-time delivery",    target: "mxsec-ontime",   noun: "on time" },
  daily:    { title: "Daily updates",       target: "mxsec-daily",    noun: "clean" },
  qc:       { title: "WMTR Workflow QC",    target: "mxsec-qc",       noun: "passed" },
  docs:     { title: "Shipping docs",       target: "mxsec-docs",     noun: "complete" },
  tracking: { title: "Tracking (AWB/BoL)",  target: "mxsec-tracking", noun: "with tracking" },
  cost_srf: { title: "Cost accuracy",       target: "mxsec-cost",     noun: "within 10%" },
  manual:   { title: "Manual flags",         target: "mxsec-manual",  noun: "clear" },
};

/* Reporting-window state. null/null === All time (no date filter). Defaults to
   whichever fiscal half we're currently in (FY starts Oct 1: First Half = Oct–Mar,
   Second Half = Apr–Sep). The user can switch to any other window, and that choice
   persists for the rest of the session. */
function mxCurrentHalfDefault() {
  const m = pmrToday().mo;                 // 1–12
  const firstHalf = (m >= 10 || m <= 3);   // Oct–Mar
  const quick = firstHalf ? "h1" : "h2";
  const info = firstHalf ? pmrFirstHalfDates() : pmrSecondHalfDates();
  return { quick, start: info.start, end: info.end, label: mxWindowLabel(quick, info.start, info.end) };
}

const _mxDefaultWindow = mxCurrentHalfDefault();
const MetricsUi = {
  start: _mxDefaultWindow.start,
  end: _mxDefaultWindow.end,
  label: _mxDefaultWindow.label,
  quick: _mxDefaultWindow.quick,   // which quick button is active
  ignoreOpen: false,               // shared "Ignored" box open state (PMR/Metrics)
  repaint: null,                   // set by renderMetricsDashboard so the Ignore UI can refresh
};

/* ---------------- friendly window labels ---------------- */

function mxWindowLabel(quick, start, end) {
  switch (quick) {
    case "all": return "All time";
    case "cfy": return "Current FY (FY" + pmrCurrentFiscalYear() + ")";
    case "pfy": return "Previous FY (FY" + (pmrCurrentFiscalYear() - 1) + ")";
    case "cq":  return "Current Qtr · " + pmrCurrentQuarterLabel();
    case "pq":  { const i = pmrPreviousQtrInfo(); return "Previous Qtr · " + i.qtr + " FY" + i.fy; }
    case "h1":  return "FY" + pmrCurrentFiscalYear() + " First Half";
    case "h2":  return "FY" + pmrCurrentFiscalYear() + " Second Half";
    default:    return (start && end) ? (start + " → " + end) : "All time";
  }
}

/* ---------------- SVG chart builders (no dependencies) ---------------- */

function mxEsc(s) { return esc(s); }

/**
 * Horizontal bar chart.
 *   rows:  array of [..]; label(r)/value(r) pull the category + numeric value.
 *   opts:  { color, money (bool), max (rows; default all), keepZero,
 *            rowH, gap, labelW, valW, W, labelSize, valSize }
 * Returns an <svg> string sized to its row count; scales to the largest value.
 */
function mxBarsSvg(rows, opts) {
  const o = opts || {};
  const color = o.color || MX_COLORS.accent;
  const money = !!o.money;
  const maxRows = o.max || Infinity;   // default: show everything

  const data = rows
    .map((r) => ({ label: String(o.label(r)), value: Number(o.value(r)) || 0 }))
    .filter((d) => d.value !== 0 || o.keepZero)
    .sort((a, b) => b.value - a.value)
    .slice(0, maxRows);

  if (!data.length) {
    return `<div class="mx-empty">No data in this window.</div>`;
  }

  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const rowH = o.rowH || 26, gap = o.gap != null ? o.gap : 8, padT = 6, padB = 6;
  const labelW = o.labelW || 150, valW = o.valW || 92;
  const W = o.W || 560;
  const labelSize = o.labelSize || 12, valSize = o.valSize || 11;
  const barAreaW = W - labelW - valW;
  const H = padT + padB + data.length * rowH + (data.length - 1) * gap;
  const barH = Math.max(4, rowH - 6);

  const fmtVal = (v) => money
    ? "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : v.toLocaleString("en-US");

  let bars = "";
  data.forEach((d, i) => {
    const y = padT + i * (rowH + gap);
    const w = Math.max(2, Math.round((d.value / maxVal) * barAreaW));
    const barY = y + (rowH - barH) / 2;
    bars += `
      <text x="${labelW - 8}" y="${y + rowH / 2}" class="mx-blabel" style="font-size:${labelSize}px" text-anchor="end" dominant-baseline="middle">${mxEsc(d.label)}</text>
      <rect x="${labelW}" y="${barY}" width="${barAreaW}" height="${barH}" rx="3" fill="${MX_COLORS.track}"/>
      <rect x="${labelW}" y="${barY}" width="${w}" height="${barH}" rx="3" fill="${color}"/>
      <text x="${labelW + barAreaW + 8}" y="${y + rowH / 2}" class="mx-bval" style="font-size:${valSize}px" dominant-baseline="middle">${mxEsc(fmtVal(d.value))}</text>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" class="mx-chart" preserveAspectRatio="xMinYMin meet"
               role="img" width="100%">${bars}</svg>`;
}

/**
 * On-time donut. center = on-time %. Three segments: on-time / late / missing-NLT.
 * `r` is the PMR result.
 */
function mxOnTimeDonutSvg(r) {
  const onTime = r.on_time_count;
  const late = r.late_count;
  const missing = r.no_nlt_count;
  const total = onTime + late + missing;

  const size = 168, cx = size / 2, cy = size / 2, rad = 64, stroke = 22;
  const circ = 2 * Math.PI * rad;

  const segs = [
    { v: onTime, color: MX_COLORS.green },
    { v: late, color: MX_COLORS.red },
    { v: missing, color: MX_COLORS.steel },
  ];

  let ringEls = `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="${MX_COLORS.track}" stroke-width="${stroke}"/>`;
  if (total > 0) {
    let offset = 0;
    for (const s of segs) {
      if (s.v <= 0) continue;
      const len = (s.v / total) * circ;
      ringEls += `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none"
        stroke="${s.color}" stroke-width="${stroke}"
        stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})"/>`;
      offset += len;
    }
  }

  const pct = r.on_time_pct;
  // Requirement is 100%. Anything below target is red to draw attention.
  const pctColor = total === 0 ? MX_COLORS.steel
    : pct >= 100 ? MX_COLORS.green : MX_COLORS.red;

  return `
    <svg viewBox="0 0 ${size} ${size}" class="mx-donut" width="${size}" height="${size}" role="img">
      ${ringEls}
      <text x="${cx}" y="${cy - 4}" class="mx-donut-pct" text-anchor="middle"
            fill="${pctColor}">${total ? pct.toFixed(1) + "%" : "—"}</text>
      <text x="${cx}" y="${cy + 16}" class="mx-donut-sub" text-anchor="middle">on time</text>
    </svg>`;
}

/* ---------------- Daily Update Check (new in 2.5.0) ---------------- */

/**
 * Compliance donut for the Daily Update Check. Two slices (compliant / flagged);
 * center shows the compliant %. `d` is result.daily_update from pmrDailyUpdateCheck.
 */
function mxDailyDonutSvg(d) {
  const compliant = d.compliant;
  const flagged = Math.max(0, d.with_daily - d.compliant);
  const total = compliant + flagged;

  const size = 168, cx = size / 2, cy = size / 2, rad = 64, stroke = 22;
  const circ = 2 * Math.PI * rad;

  const segs = [
    { v: compliant, color: MX_COLORS.green },
    { v: flagged, color: MX_COLORS.red },
  ];

  let ringEls = `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="${MX_COLORS.track}" stroke-width="${stroke}"/>`;
  if (total > 0) {
    let offset = 0;
    for (const s of segs) {
      if (s.v <= 0) continue;
      const len = (s.v / total) * circ;
      ringEls += `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none"
        stroke="${s.color}" stroke-width="${stroke}"
        stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})"/>`;
      offset += len;
    }
  }

  const pct = d.compliant_pct;
  const pctColor = total === 0 ? MX_COLORS.steel
    : pct >= 90 ? MX_COLORS.green : pct >= 75 ? MX_COLORS.accent : MX_COLORS.red;

  return `
    <svg viewBox="0 0 ${size} ${size}" class="mx-donut" width="${size}" height="${size}" role="img">
      ${ringEls}
      <text x="${cx}" y="${cy - 4}" class="mx-donut-pct" text-anchor="middle"
            fill="${pctColor}">${total ? pct.toFixed(1) + "%" : "—"}</text>
      <text x="${cx}" y="${cy + 16}" class="mx-donut-sub" text-anchor="middle">compliant</text>
    </svg>`;
}

/**
 * Daily Update Check panel (metric-group section, id=mxsec-daily). Driven by each
 * WMTR's Daily Status History and scoped to the reporting window via the caller's
 * precomputed result, so it repaints in its own host when the window changes.
 */
function mxRenderDailyUpdateSection(dash, precomputed) {
  let d = precomputed;
  if (d === undefined) {
    try { d = (typeof pmrDailyUpdateCheck === "function") ? pmrDailyUpdateCheck(AppState.grid) : null; }
    catch (e) { d = null; }
  }
  if (!d) return;

  const windowed = !!(d.window_start && d.window_end);
  const countLabel = windowed
    ? `${d.with_daily} WMTR${d.with_daily === 1 ? "" : "s"} with daily activity in window${d.with_daily ? ` · ${d.compliant} clean` : ""}`
    : `${d.with_daily} of ${d.total_records} WMTRs have daily logs${d.with_daily ? ` · ${d.compliant} clean` : ""}`;

  const panel = el(`
    <div class="panel mx-daily" id="mxsec-daily">
      <header>
        <h2>Daily Update Check</h2>
        <span class="count">${countLabel}</span>
      </header>
      <div class="body" id="mxDailyBody"></div>
    </div>`);
  dash.appendChild(panel);
  const host = panel.querySelector("#mxDailyBody");

  host.appendChild(el(`<div class="hint" style="margin-bottom:12px;">A daily entry is expected for every <strong>business day</strong> a WMTR is being logged — weekends and US federal holidays are skipped. A WMTR is flagged when a business day with no entry falls inside the reporting window above (checked over the part of each WMTR's logged span that overlaps the window). Only WMTRs that already have a Daily Status History are checked.</div>`));

  if (!d.with_daily) {
    host.appendChild(el(`<div class="mx-empty">No WMTRs have a Daily Status History in this window — nothing to check.</div>`));
    return;
  }

  host.appendChild(el(`
    <div class="mx-grid2">
      <div class="panel" style="box-shadow:none;border:none;">
        <div class="body mx-donutwrap">
          ${mxDailyDonutSvg(d)}
          <ul class="mx-legend">
            <li><span class="mx-dot" style="background:${MX_COLORS.green}"></span>Clean <b>${d.compliant}</b></li>
            <li><span class="mx-dot" style="background:${MX_COLORS.red}"></span>Has gaps <b>${d.has_gaps}</b></li>
          </ul>
        </div>
      </div>
      <div class="panel" style="box-shadow:none;border:none;">
        <div class="body">
          <div class="stats mx-kpis">
            <div class="stat"><div class="k">WMTRs with logs</div><div class="v">${d.with_daily}</div></div>
            <div class="stat"><div class="k">No gaps</div><div class="v ${d.has_gaps === 0 ? "mx-good" : ""}">${d.compliant_pct.toFixed(1)}%</div></div>
            <div class="stat"><div class="k">Flagged (gaps)</div><div class="v ${d.has_gaps ? "mx-bad" : ""}">${d.has_gaps}</div></div>
          </div>
        </div>
      </div>
    </div>`));

  // Per-WMTR detail (flagged rows first; clean rows shown with an OK badge).
  const idOf = (w) => String(w || "").toUpperCase().replace(/-SRF$/, "");
  const okBadge = `<span class="badge" style="background:rgba(30,127,79,.14);color:#1E7F4F;border:1px solid rgba(30,127,79,.4);">OK</span>`;
  const body = d.rows.map((r) => {
    const flagged = r.status !== "OK";
    const statusCell = flagged
      ? `<span style="color:#B00000;">${esc(r.status)}</span>`
      : okBadge;
    const missCell = r.missing.length
      ? `<span class="mx-missdates">${r.missing.map((iso) => esc(mxIsoToDmy(iso))).join(", ")}</span>`
      : `<span style="color:var(--steel)">—</span>`;
    return `
      <tr>
        <td class="mono">${esc(idOf(r.wmtr))}</td>
        <td>${esc(r.first)}</td>
        <td>${esc(r.last)}</td>
        <td class="num">${r.entries}</td>
        <td class="num">${r.missing_count}</td>
        <td class="mx-misscell">${missCell}</td>
        <td>${statusCell}</td>
      </tr>`;
  }).join("");

  host.appendChild(el(`
    <div class="scrollwrap" style="max-height:340px;margin-top:8px;">
      <table class="data">
        <thead><tr>
          <th>WMTR #</th><th>First entry</th><th>Last entry</th>
          <th>Entries</th><th>Missing</th><th>Missing business days</th><th>Status</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`));
}

/* ---------------- tiny at-a-glance visuals (2.5.0 dashboard) ------------- */

/** Small sparkline-style vertical bars for a dashboard card. */
function mxMiniBars(values, color, opts) {
  const o = opts || {};
  const W = o.W || 96, H = o.H || 34, maxN = o.max || 8;
  const data = (values || []).map(Number).filter((v) => !isNaN(v)).slice(0, maxN);
  if (!data.length || Math.max(...data) <= 0) {
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="mx-mini" preserveAspectRatio="none" role="img"></svg>`;
  }
  const max = Math.max(...data, 1), gap = 2, n = data.length;
  const bw = (W - (n - 1) * gap) / n;
  let bars = "";
  data.forEach((v, i) => {
    const h = Math.max(2, Math.round((v / max) * (H - 2)));
    const x = i * (bw + gap), y = H - h;
    bars += `<rect x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${h}" rx="1" fill="${color}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="mx-mini" preserveAspectRatio="none" role="img">${bars}</svg>`;
}

/** Small progress ring (0–100) for a dashboard card. */
function mxMiniRing(pct, color) {
  const size = 34, cx = size / 2, cy = size / 2, rad = 13, stroke = 5;
  const circ = 2 * Math.PI * rad;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const len = (p / 100) * circ;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="mx-mini-ring" role="img">
    <circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="${MX_COLORS.track}" stroke-width="${stroke}"/>
    <circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})"/>
  </svg>`;
}

/** Smooth-scroll to a detail section by id and flash it for orientation. */
function mxScrollToSection(id) {
  const sec = document.getElementById(id);
  if (!sec) return;
  sec.scrollIntoView({ behavior: "smooth", block: "start" });
  sec.classList.remove("mx-flash");
  void sec.offsetWidth;        // restart the animation
  sec.classList.add("mx-flash");
}

/** "2026-03-25" -> "25-Mar-2026" (matches the UDQ's Daily Status date style). */
const MX_MONTHS_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function mxIsoToDmy(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  return `${m[3]}-${MX_MONTHS_ABBR[(+m[2]) - 1]}-${m[1]}`;
}

/* ---------------- program merge (count + cost + value) ---------------- */

function mxProgramRows(r) {
  const map = {};
  const touch = (p) => (map[p] = map[p] || { count: 0, cost: 0, value: 0 });
  for (const [p, c] of r.program_count_rows) touch(p).count = c;
  for (const [p, , cost] of r.cost_rows) touch(p).cost = cost;
  for (const [p, , value] of r.value_rows) touch(p).value = value;
  return Object.entries(map)
    .map(([p, v]) => ({ program: p, count: v.count, cost: v.cost, value: v.value }))
    .sort((a, b) => b.count - a.count || a.program.localeCompare(b.program));
}

/* ---------------- main render ---------------- */

function renderMetricsDashboard(dash) {
  // Count WMTR records in the file (for the badge) — independent of the window.
  let recordCount = 0;
  for (let rr = 1; rr <= gridMaxRow(AppState.grid); rr++) {
    const v = normWs(gridCell(AppState.grid, rr, 1)).toUpperCase();
    if (v.startsWith("WMTR-") && v.endsWith("-SRF")) recordCount++;
  }

  /* ---- Manifest strip + reporting-window control ---- */
  const manifest = el(`
    <div class="manifest mx-manifest">
      <div>
        <span class="wmtr">METRICS DATASET</span>
        <span class="badge">Metrics · ${recordCount} SRF record${recordCount === 1 ? "" : "s"}</span>
      </div>
      <div></div><div></div>
      <div class="title">${esc(AppState.fileName || "Metrics UDQ")}</div>
      <div class="mx-windowbar">
        <span class="mx-windowlabel" id="mxWindowLabel">${esc(MetricsUi.label)}</span>
      </div>
    </div>`);
  dash.appendChild(manifest);

  const control = el(`
    <div class="panel mx-control">
      <div class="body">
        <div class="mx-quickrow">
          <label class="pmr-qlabel">Reporting window</label>
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
          <div class="field"><label for="mxStart">Custom start</label><input type="date" id="mxStart"></div>
          <div class="field"><label for="mxEnd">Custom end</label><input type="date" id="mxEnd"></div>
          <div class="field mx-applycell"><button class="btn primary" id="mxApply">Apply range</button></div>
          <div class="hint mx-windowhint">Fiscal year starts Oct 1. "All time" counts every delivered WMTR, ignoring dates. These figures use the same engine as the PMR tool, so they match the PMR export.</div>
        </div>
        <div class="btnrow mx-exportrow" style="margin-top:8px;">
          <button class="btn" id="mxExportSummary">Export summary (.xlsx)</button>
          <button class="btn ghost" id="mxIgnoredBtn" type="button" title="Manage acknowledged / hidden flags">Ignored</button>
          <span class="statusline" id="mxSummaryStatus"></span>
        </div>
      </div>
    </div>`);
  // (control is appended below, after the flagged box, so it follows the
  // window-independent alert at the very top of the section.)

  /* ---- Consolidation count (structural; window-independent) ---- */
  let consolCount = 0;
  try {
    const a = (typeof analyzeConsolidation === "function") ? analyzeConsolidation(AppState.grid) : null;
    consolCount = a && a.clusters ? a.clusters.length : 0;
  } catch (e) { consolCount = 0; }

  dash.appendChild(control);

  /* ---- At-a-glance dashboard (upper section, ≤ 2/3 viewport) ---- */
  const dashPanel = el(`
    <div class="panel mx-dashboard">
      <header><h2>Dashboard — at a glance</h2><span class="count">Tap a metric to jump to its detail</span></header>
      <div class="body"><div class="mx-dash-cap"><div class="mx-dashcards" id="mxDashGrid"></div></div></div>
    </div>`);
  dash.appendChild(dashPanel);
  const dashGrid = dashPanel.querySelector("#mxDashGrid");
  // Delegated click -> smooth scroll to the matching detail section.
  dashGrid.addEventListener("click", (e) => {
    const card = e.target.closest("[data-target]");
    if (card && card.dataset.target) mxScrollToSection(card.dataset.target);
  });

  /* ---- Window-independent alerts lead the detail area (data-quality strip +
         flagged daily gaps). Repainted with the window. ---- */
  const alertHost = el(`<div id="mxAlertHost"></div>`);
  dash.appendChild(alertHost);

  /* =====================================================================
     The detail area is split into two clearly-separated groups, each in the
     same order as its row of cards up top:
       • METRIC BREAKDOWNS — the RYG-scored metrics, in metric-card order:
         on-time, daily, QC, shipping docs, tracking, cost, manual.
       • REFERENCE & DETAIL — the neutral info figures, in info-card order:
         contents, program, destinations, mode, canceled, consolidated.
     Every section gets its own stable host so the order is fixed and each can
     repaint in place without disturbing its neighbors. Window-independent
     sections (Shipping docs, Consolidated) are rendered once; the rest repaint
     with the reporting window.
     ===================================================================== */
  const mkHost = (id) => { const h = el(`<div id="${id}"></div>`); return h; };

  // ---- Group A: metric breakdowns ----
  dash.appendChild(el(`<div class="mx-detail-sep mx-group-sep"><h2>Metric breakdowns</h2></div>`));
  const gMetric = el(`<div id="mxMetricGroup"></div>`);
  dash.appendChild(gMetric);
  const hOntime   = mkHost("mxHostOntime");   gMetric.appendChild(hOntime);
  const hDaily    = mkHost("mxHostDaily");     gMetric.appendChild(hDaily);
  const hQc       = mkHost("mxHostQc");         gMetric.appendChild(hQc);
  const hDocs     = mkHost("mxHostDocs");       gMetric.appendChild(hDocs);      // Shipping docs (embedded Required Attachments) — once
  const hTracking = mkHost("mxHostTracking");   gMetric.appendChild(hTracking);
  const hCost     = mkHost("mxHostCost");       gMetric.appendChild(hCost);
  const hManual   = mkHost("mxHostManual");     gMetric.appendChild(hManual);

  // ---- Group B: reference & detail ----
  dash.appendChild(el(`<div class="mx-detail-sep mx-group-sep"><h2>Reference &amp; detail</h2></div>`));
  const gInfo = el(`<div id="mxInfoGroup"></div>`);
  dash.appendChild(gInfo);
  const hContents  = mkHost("mxHostContents");  gInfo.appendChild(hContents);
  const hProgram   = mkHost("mxHostProgram");    gInfo.appendChild(hProgram);
  const hDest      = mkHost("mxHostDest");        gInfo.appendChild(hDest);
  const hMode      = mkHost("mxHostMode");        gInfo.appendChild(hMode);
  const hCancelled = mkHost("mxHostCancelled");   gInfo.appendChild(hCancelled);
  const hConsol    = mkHost("mxHostConsol");      gInfo.appendChild(hConsol);

  // Window-independent sections, rendered once. Shipping docs embeds the full
  // Required Attachments window (its own period picker), which is why it moved
  // out of the left menu — this IS that tool, now living in the Metrics list.
  mxRenderDocsSection(hDocs);
  mxRenderConsolSection(hConsol);

  /* ---- wire window controls ---- */
  const setActiveQuick = () => {
    control.querySelectorAll(".mx-quick").forEach((b) =>
      b.classList.toggle("active", b.dataset.q === MetricsUi.quick));
  };
  setActiveQuick();

  const repaint = () => {
    document.getElementById("mxWindowLabel").textContent = MetricsUi.label;
    setActiveQuick();
    let res = null, err = "";
    try { res = pmrRun(AppState.grid, MetricsUi.start, MetricsUi.end); }
    catch (e) { err = e.message || String(e); }

    // Daily Update Check is scoped to the same reporting window as the rest of
    // the metrics, so it updates whenever the range changes.
    let daily = null;
    try { daily = (typeof pmrDailyUpdateCheck === "function") ? pmrDailyUpdateCheck(AppState.grid, MetricsUi.start, MetricsUi.end) : null; }
    catch (e) { daily = null; }

    // Row-sourced per-WMTR pass/fail detail for the QC / tracking / cost
    // sections — scoped to the same window as (and computed from the same
    // metric defs as) the metric cards, so the section totals can't disagree
    // with the card percentages.
    let detail = null;
    try { detail = mxRowMetricDetail(AppState.grid, MetricsUi.start, MetricsUi.end); }
    catch (e) { detail = null; }

    mxRenderDashboardCards(dashGrid, res, err, daily, consolCount);

    // Alerts (data-quality strip + flagged daily gaps).
    const ah = document.getElementById("mxAlertHost");
    if (ah) { ah.innerHTML = ""; mxRenderDataQualityStrip(ah, res, err); mxRenderFlaggedBox(ah, daily); }

    // Group A — metric breakdowns (card order).
    const fill = (host, fn) => { if (host) { host.innerHTML = ""; try { fn(host); } catch (e) { /* keep other sections alive */ } } };
    fill(document.getElementById("mxHostOntime"),   (h) => mxRenderOntimeSection(h, res, err));
    fill(document.getElementById("mxHostDaily"),    (h) => mxRenderDailyUpdateSection(h, daily));
    fill(document.getElementById("mxHostQc"),       (h) => mxRenderQcSection(h, detail));
    fill(document.getElementById("mxHostTracking"), (h) => mxRenderTrackingSection(h, detail));
    fill(document.getElementById("mxHostCost"),     (h) => mxRenderCostSection(h, detail));
    fill(document.getElementById("mxHostManual"),   (h) => mxRenderManualSection(h));

    // Group B — reference & detail (info-card order). Consolidated is window-
    // independent and already rendered once above.
    fill(document.getElementById("mxHostContents"),  (h) => mxRenderContentsSection(h, res, err));
    fill(document.getElementById("mxHostProgram"),   (h) => mxRenderProgramSection(h, res, err));
    fill(document.getElementById("mxHostDest"),      (h) => mxRenderDestSection(h, res, err));
    fill(document.getElementById("mxHostMode"),      (h) => mxRenderModeSection(h, res, err));
    fill(document.getElementById("mxHostCancelled"), (h) => mxRenderCancelledSection(h, res, err));

    // Keep the "Ignored (N)" button label in sync with the acknowledged count.
    const ib = document.getElementById("mxIgnoredBtn");
    if (ib) { const n = (typeof pmrmxCount === "function") ? pmrmxCount() : 0; ib.textContent = n ? `Ignored (${n})` : "Ignored"; }
  };
  MetricsUi.repaint = repaint;

  const quickMap = {
    all: () => ({ start: null, end: null }),
    cfy: () => pmrCurrentFyDates(),
    pfy: () => pmrPreviousFyDates(),
    cq:  () => pmrCurrentQtrDates(),
    pq:  () => pmrPreviousQtrInfo(),
    h1:  () => pmrFirstHalfDates(),
    h2:  () => pmrSecondHalfDates(),
  };

  control.querySelectorAll(".mx-quick").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = btn.dataset.q;
      const info = quickMap[q]();
      MetricsUi.quick = q;
      MetricsUi.start = info.start || null;
      MetricsUi.end = info.end || null;
      MetricsUi.label = mxWindowLabel(q, MetricsUi.start, MetricsUi.end);
      // Mirror the chosen range into the custom inputs (blank for All time).
      control.querySelector("#mxStart").value = MetricsUi.start || "";
      control.querySelector("#mxEnd").value = MetricsUi.end || "";
      repaint();
    });
  });

  control.querySelector("#mxApply").addEventListener("click", () => {
    const s = control.querySelector("#mxStart").value;
    const e = control.querySelector("#mxEnd").value;
    if (!s || !e) { MetricsUi._warn = "Pick both a start and an end date."; repaint(); return; }
    if (s > e) { MetricsUi._warn = "Start date is after end date."; repaint(); return; }
    MetricsUi._warn = "";
    MetricsUi.quick = "custom";
    MetricsUi.start = s; MetricsUi.end = e;
    MetricsUi.label = s + " → " + e;
    repaint();
  });

  // Seed custom inputs from current state.
  control.querySelector("#mxStart").value = MetricsUi.start || "";
  control.querySelector("#mxEnd").value = MetricsUi.end || "";

  control.querySelector("#mxExportSummary").addEventListener("click", mxExportSummary);
  control.querySelector("#mxIgnoredBtn").addEventListener("click", mxOpenIgnoreModal);

  // Initial paint (dashboard cards + every window-dependent detail section).
  repaint();
}

/* =========================================================================
   "Ignored" modal — manage acknowledged / hidden flags in one window.
   Opened from the button next to Export. Reuses the shared PMR/Metrics ignore
   store (pmrmx*), so anything hidden here is hidden everywhere it applies.
   ========================================================================= */
function mxOpenIgnoreModal() {
  if (document.getElementById("mxIgnoreOverlay")) return;    // already open
  if (typeof pmrmxInjectStyle === "function") pmrmxInjectStyle();

  const catOpts = ["*"].concat(typeof PMRMX_CATS !== "undefined" ? PMRMX_CATS : [])
    .map((k) => `<option value="${k}">${esc((typeof PMRMX_CAT_LABELS !== "undefined" && PMRMX_CAT_LABELS[k]) || k)}</option>`).join("");

  const overlay = el(`
    <div id="mxIgnoreOverlay" style="position:fixed;inset:0;z-index:1000;background:rgba(10,18,28,.55);display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px;">
      <div role="dialog" aria-modal="true" aria-label="Ignored requests"
           style="background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:var(--radius-panel,10px);max-width:640px;width:100%;max-height:88vh;overflow:auto;box-shadow:0 18px 50px rgba(10,18,28,.4);">
        <header style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line);">
          <h2 style="margin:0;font:600 17px/1.1 var(--disp);text-transform:uppercase;letter-spacing:1.5px;">Ignored requests</h2>
          <button id="mxIgnoreX" class="btn ghost" type="button" aria-label="Close" title="Close" style="padding:2px 11px;">\u00d7</button>
        </header>
        <div style="padding:14px 16px;">
          <div class="hint" style="margin:0 0 10px;">Hide data-quality reminders you've already reviewed. This affects only the on-screen flags — it never changes any count, percentage, or exported report.</div>
          <div class="pmrmx-ignore-add" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
            <input type="text" id="mxIgWmtr" placeholder="WMTR number (full or last 5, e.g. 10097)" spellcheck="false" autocomplete="off" style="flex:1;min-width:220px;">
            <select id="mxIgCat">${catOpts}</select>
            <button class="btn primary" id="mxIgAdd" type="button">Ignore</button>
          </div>
          <div id="mxIgList"></div>
        </div>
        <div style="display:flex;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--line);">
          <button class="btn ghost" id="mxIgClose" type="button">Close</button>
        </div>
      </div>
    </div>`);

  const esc2 = (e) => { if (e.key === "Escape") close(); };
  function close() { document.removeEventListener("keydown", esc2); overlay.remove(); }

  const sync = () => { if (typeof MetricsUi.repaint === "function") MetricsUi.repaint(); };
  const refreshList = () => pmrmxRenderIgnoreList(overlay.querySelector("#mxIgList"), () => { refreshList(); sync(); });

  const add = () => {
    const inp = overlay.querySelector("#mxIgWmtr");
    const raw = inp.value.trim();
    if (!raw) return;
    pmrmxAddIgnore(raw, overlay.querySelector("#mxIgCat").value);
    inp.value = "";
    refreshList();
    sync();
  };

  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#mxIgnoreX").addEventListener("click", close);
  overlay.querySelector("#mxIgClose").addEventListener("click", close);
  overlay.querySelector("#mxIgAdd").addEventListener("click", add);
  overlay.querySelector("#mxIgWmtr").addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  document.addEventListener("keydown", esc2);

  document.body.appendChild(overlay);
  refreshList();
  overlay.querySelector("#mxIgWmtr").focus();
}

/* =========================================================================
   Flagged-WMTR box (Daily Update issues) — shown in the detail area.
   ========================================================================= */
function mxRenderFlaggedBox(dash, daily) {
  const idOf = (w) => String(w || "").toUpperCase().replace(/-SRF$/, "");
  if (typeof pmrmxInjectStyle === "function") pmrmxInjectStyle();
  if (!daily || !daily.with_daily) return;

  const ignoreOn = (typeof pmrmxIsIgnored === "function");
  const flaggedAll = daily.rows.filter((r) => r.status !== "OK");
  const flagged = ignoreOn ? flaggedAll.filter((r) => !pmrmxIsIgnored(r.wmtr, "daily")) : flaggedAll;
  const acked = flaggedAll.length - flagged.length;

  if (!flaggedAll.length) {
    // All up to date — the "Daily updates" metric card already says so, so no
    // note here (keeps the detail area clean).
    return;
  }

  // Every flagged WMTR has been acknowledged — drop the red alarm to a slim note.
  // (The compliance donut and the Daily Update Check table below still show the
  // true, unfiltered gap counts.)
  if (!flagged.length) {
    dash.appendChild(el(`
      <div class="panel mx-flag-ok"><div class="body">
        <div class="statusline">Daily Update Check — ${flaggedAll.length} flagged WMTR${flaggedAll.length === 1 ? "" : "s"} acknowledged &amp; hidden. Manage in “Ignored”.</div>
      </div></div>`));
    return;
  }

  const chips = flagged.map((r) =>
    `<span class="mx-chip" data-target="mxsec-daily" data-wmtr="${esc(r.wmtr)}" title="Missing: ${esc(r.missing.map(mxIsoToDmy).join(", "))}">${esc(idOf(r.wmtr))} · ${r.missing_count} missing<button class="pmrmx-ackx" data-wmtr="${esc(r.wmtr)}" type="button" title="Acknowledge &amp; hide this WMTR's daily-gap flag">\u00d7</button></span>`
  ).join("");

  const ackNote = acked
    ? ` <span class="pmrmx-acknote">· +${acked} acknowledged &amp; hidden</span>`
    : "";

  const box = el(`
    <div class="panel mx-flagged">
      <header>
        <h2 style="color:#B00000;">⚑ Daily Update — flagged WMTRs</h2>
        <span class="count">${flagged.length} of ${daily.with_daily} with gaps${ackNote}</span>
      </header>
      <div class="body">
        <div class="statusline">These WMTRs are missing a daily entry on one or more business days (weekends &amp; US federal holidays excluded). Tap one to jump to the full Daily Update Check below, or “×” to acknowledge and hide it.</div>
        <div class="mx-chiprow" style="margin-top:8px;">${chips}</div>
      </div>
    </div>`);
  box.querySelector(".mx-chiprow").addEventListener("click", (e) => {
    const x = e.target.closest(".pmrmx-ackx");
    if (x) {
      e.stopPropagation();
      if (typeof pmrmxAddIgnore === "function") pmrmxAddIgnore(x.getAttribute("data-wmtr"), "daily");
      if (typeof MetricsUi.repaint === "function") MetricsUi.repaint();
      return;
    }
    const chip = e.target.closest(".mx-chip");
    if (chip && chip.dataset.target) mxScrollToSection(chip.dataset.target);
  });
  dash.appendChild(box);
}

/* Count SRF WMTRs manually flagged via the DTRA-Only comments field (loaded UDQ,
   window-independent). Used to decide whether the shared Ignored manager shows. */
function mxManualFlagCount() {
  if (typeof xtParseRecords !== "function") return 0;
  try {
    return (xtParseRecords(AppState.grid, "SRF").records || [])
      .filter((r) => norm(r.scalar && r.scalar.manualMetric)).length;
  } catch (e) { return 0; }
}

/* =========================================================================
   Manually-entered metric flags (SRF) — pinned near the top.

   A reviewer flags a WMTR that busted a metric the utility can't detect (e.g. a
   lost package) by putting a note in the repurposed "DTRA-Only Import/Export
   Comments" field. This box lists every such SRF WMTR in the loaded UDQ with its
   note as the reason. It is window-independent on purpose — a flagged WMTR may
   never have been delivered (that's often the point), so it should surface
   regardless of the reporting window. Each flag can be acknowledged/hidden via
   the shared PMR/Metrics ignore list (category "manual"); the count is unaffected.
   ========================================================================= */
function mxRenderManualMetricBox(dash) {
  if (typeof xtParseRecords !== "function") return;
  if (typeof pmrmxInjectStyle === "function") pmrmxInjectStyle();

  let recs = [];
  try { recs = (xtParseRecords(AppState.grid, "SRF").records) || []; } catch (e) { recs = []; }
  const flaggedAll = recs
    .map((r) => ({ wmtr: r.wmtr, note: norm(r.scalar && r.scalar.manualMetric) }))
    .filter((r) => r.note);
  if (!flaggedAll.length) return;                    // nothing manually flagged

  const idOf = (w) => String(w || "").toUpperCase().replace(/-SRF$/, "");
  const ignoreOn = (typeof pmrmxIsIgnored === "function");
  const flagged = ignoreOn ? flaggedAll.filter((r) => !pmrmxIsIgnored(r.wmtr, "manual")) : flaggedAll;
  const acked = flaggedAll.length - flagged.length;

  if (!flagged.length) {
    dash.appendChild(el(`
      <div class="panel mx-flag-ok" id="mxsec-manual"><div class="body">
        <div class="statusline">Manually-entered metrics — ${flaggedAll.length} flagged WMTR${flaggedAll.length === 1 ? "" : "s"} acknowledged &amp; hidden. Manage in “Ignored”.</div>
      </div></div>`));
    return;
  }

  const rows = flagged.map((r) =>
    `<div style="display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-top:1px solid var(--line);">
       <span style="font-family:var(--mono);font-size:12px;white-space:nowrap;">${esc(idOf(r.wmtr))}</span>
       <span style="flex:1;font-size:12.5px;color:var(--ink);">${esc(r.note)}</span>
       <button class="pmrmx-ackx" data-wmtr="${esc(r.wmtr)}" type="button" title="Acknowledge &amp; hide this manual flag">\u00d7</button>
     </div>`
  ).join("");

  const ackNote = acked ? ` <span class="pmrmx-acknote">· +${acked} acknowledged &amp; hidden</span>` : "";

  const box = el(`
    <div class="panel mx-flagged" id="mxsec-manual">
      <header>
        <h2 style="color:#B00000;">⚑ Manually-entered metrics — flagged WMTRs</h2>
        <span class="count">${flagged.length} flagged${ackNote}</span>
      </header>
      <div class="body">
        <div class="statusline">These WMTRs were manually flagged (a note in the DTRA-Only Import/Export Comments field) as busting a metric the utility can't detect on its own. “×” acknowledges &amp; hides a flag.</div>
        <div class="mx-manuallist" style="margin-top:6px;">${rows}</div>
      </div>
    </div>`);
  box.querySelector(".mx-manuallist").addEventListener("click", (e) => {
    const x = e.target.closest(".pmrmx-ackx");
    if (x && typeof pmrmxAddIgnore === "function") {
      pmrmxAddIgnore(x.getAttribute("data-wmtr"), "manual");
      if (typeof MetricsUi.repaint === "function") MetricsUi.repaint();
    }
  });
  dash.appendChild(box);
}

/* =========================================================================
   Inventory line-item / piece counts (for the two dashboard cards)

   Both figures are scoped to the SAME shipments the rest of the dashboard
   counts: the delivered, in-window WMTRs in pmrRun().delivered_wmtrs. As the
   reporting window changes, the counts change with it.

   Counting rules (see the "Shipment contents" note in the detail region):
     • "P" (package/parent) rows — the boxes/pallets themselves — are excluded
       from both counts, matching how the SRF reader treats packages as NOT
       line items. Only the goods inside are counted.
     • Line items: DISTINCT items within a WMTR's inventory. When the same item
       is listed on several rows instead of using the Quantity column, those
       rows collapse to one line item. Identity = Description + Model/Catalog
       Number (case-insensitive, whitespace-normalized). De-duplication is per
       WMTR, so the same item shipped on two different WMTRs is two line items.
     • Pieces: the total Quantity shipped — the Quantity column summed across
       every non-package row. A row with a blank/zero Quantity counts as 1 piece
       (matching the package convention), so listing an item on N rows without a
       Quantity still yields N pieces.
   ========================================================================= */

/** Canonical WMTR key for matching inventory parents against delivered_wmtrs. */
function mxWmtrKey(v) {
  return String(v == null ? "" : v).replace(/\u00A0/g, " ").trim().toUpperCase().replace(/-SRF$/, "");
}

/* Parse is O(rows); memoize per grid so window switches don't re-walk the file. */
let _mxInvCache = { grid: null, byWmtr: null };

/**
 * Per-WMTR inventory contributions, keyed by mxWmtrKey(parent WMTR):
 *   { line_items, pieces, rows, packages }
 * line_items is already de-duplicated within the WMTR; pieces already excludes
 * packages. Callers sum these over the delivered set for the active window.
 */
function mxInventoryByWmtr(grid) {
  if (_mxInvCache.grid === grid && _mxInvCache.byWmtr) return _mxInvCache.byWmtr;

  const byWmtr = {};
  let sections = [];
  try { sections = (typeof readInventorySections === "function") ? readInventorySections(grid) : []; }
  catch (e) { sections = []; }

  for (const sec of sections) {
    const key = mxWmtrKey(sec.parentWmtr);
    if (!key) continue;
    const agg = byWmtr[key] || (byWmtr[key] = { line_items: 0, pieces: 0, rows: 0, packages: 0 });
    const seen = Object.create(null);   // distinct (desc|model) within THIS WMTR
    for (const it of sec.items) {
      // Package/parent rows: the container, not shipped goods — excluded.
      if (String(it.serial || "").toUpperCase() === "P") { agg.packages += 1; continue; }
      agg.rows += 1;
      // Pieces: trust the Quantity column; a blank/zero row is one physical piece.
      agg.pieces += (it.qty > 0 ? it.qty : 1);
      // Line items: collapse repeats of the same item within this WMTR.
      const idKey = (it.desc || "").toLowerCase() + "\u0001" + (it.model || "").toLowerCase();
      if (!seen[idKey]) { seen[idKey] = true; agg.line_items += 1; }
    }
  }

  _mxInvCache = { grid, byWmtr };
  return byWmtr;
}

/** Totals across the delivered, in-window WMTRs (pmrRun().delivered_wmtrs). */
function mxInventoryTotals(grid, deliveredWmtrs) {
  const byWmtr = mxInventoryByWmtr(grid);
  const out = { line_items: 0, pieces: 0, wmtrs_with_inventory: 0, packages: 0 };
  const keys = (deliveredWmtrs || []).map(mxWmtrKey);
  const uniq = Array.from(new Set(keys));   // guard against any accidental repeats
  for (const k of uniq) {
    const a = byWmtr[k];
    if (!a) continue;
    out.line_items += a.line_items;
    out.pieces += a.pieces;
    out.packages += a.packages;
    if (a.rows > 0) out.wmtrs_with_inventory += 1;
  }
  return out;
}

/* =========================================================================
   SRF metric scoring for the dashboard's status cards.

   The Metrics section tracks the SAME SRF metric set the Christmas Tree scores
   (Metrics is Shipping-only; the Tree spans SRF/PR/PMCT/WS). To guarantee the
   numbers can never diverge, this reuses the Tree's exact source calculations,
   just scoped to the dashboard's single reporting window instead of per fiscal
   quarter:
     • delivery + daily -> the pmrRun()/daily result already computed for the
       window (passed in), same as the Tree's pmr-sourced rows;
     • docs             -> reqattParseUdq() + _raEvaluate(), the ReqAtt scoring;
     • qc / tracking /
       cost_srf         -> xtParseRecords() + xtBuildRow() row signals with the
                           SRF metric defs' own elig()/pass() from the Tree.
   Records are scoped by delivery date within [start,end]. RYG thresholds come
   straight from XT_ROLLUP_METRICS, so a card is green/yellow/red exactly where
   the Tree's matching cell would be. Returns an ordered array of
   { key, def, pass, total, late } (SRF metrics only), or null if unavailable. */
function mxSrfMetricScores(grid, startIso, endIso, pr, daily) {
  if (!grid || typeof XT_ROLLUP_METRICS === "undefined") return null;
  const inWin = (iso) => !!iso && (!startIso || iso >= startIso) && (!endIso || iso <= endIso);
  const relieved = (w, iso) => (typeof pmrSrfRelieved === "function") && pmrSrfRelieved(w, iso);
  const isoOf = (v) => { try { const d = xtParseDate(v); return d ? xtIso(d) : ""; } catch (e) { return ""; } };

  const byKey = {};
  const order = [];
  for (const m of XT_ROLLUP_METRICS) {
    if (m.svc !== "SRF") continue;
    byKey[m.key] = { key: m.key, def: m, pass: 0, total: 0, late: 0 };
    order.push(m.key);
  }
  if (!order.length) return null;

  // delivery + daily: reuse the window results the dashboard already computed.
  if (byKey.delivery && pr) {
    byKey.delivery.pass = pr.on_time_count || 0;
    byKey.delivery.total = pr.nlt_scoped || 0;
    byKey.delivery.late = pr.late_count || 0;
  }
  if (byKey.daily) {
    const du = daily || (pr && pr.daily_update) || null;
    if (du) { byKey.daily.pass = du.compliant || 0; byKey.daily.total = du.with_daily || 0; }
  }

  // docs: same ReqAtt evaluation the Tree runs, window-scoped by Delivery Date.
  if (byKey.docs && typeof reqattParseUdq === "function" && typeof _raEvaluate === "function") {
    let blocks = [];
    try { blocks = reqattParseUdq(grid) || []; } catch (e) { blocks = []; }
    for (const blk of blocks) {
      const f = blk.fields || {};
      const wmtr = norm(f["WMTR Number"]);
      const dIso = isoOf(f["Delivery Date"]);
      if (!inWin(dIso)) continue;                                   // not delivered in window
      if (relieved(wmtr, dIso)) continue;                           // shared Oct-1 relief
      if (norm(f["Identify Shipment As"]).toLowerCase() === "hand carry") continue;
      const origin = norm(f["Country of Origin"]), dest = norm(f["Country of Destination"]);
      const cat = _raShipmentCategory(origin, dest);
      if (cat === "UNKNOWN") continue;                              // unclassifiable -> not scored
      const ev = _raEvaluate(cat, blk.attachment_types || [], origin, _raIsCourier(f["Identify Shipment As"]));
      byKey.docs.total += 1;
      if (!ev.missing.length) byKey.docs.pass += 1;
    }
  }

  // qc / tracking / cost_srf: row-sourced, window-scoped by delivered date.
  if (typeof xtParseRecords === "function" && typeof xtBuildRow === "function") {
    let parsed = null;
    try { parsed = xtParseRecords(grid, "SRF"); } catch (e) { parsed = null; }
    for (const rec of (parsed ? parsed.records : [])) {
      let row; try { row = xtBuildRow(rec); } catch (e) { continue; }
      if (!row.delivered) continue;
      const dIso = xtIso(row.delivered);
      if (!inWin(dIso)) continue;
      if (relieved(row.wmtr_full, dIso)) continue;
      for (const k of ["qc", "tracking", "cost_srf", "manual"]) {
        const x = byKey[k]; if (!x) continue;
        const m = x.def;
        if (!m.elig(row)) continue;
        x.total += 1;
        if (m.pass(row)) x.pass += 1;
      }
    }
  }

  return order.map((k) => byKey[k]);
}

/* RYG status ("good"/"warn"/"issue") for a pass/total ratio against a metric
   def's green/yellow thresholds — the same buckets xtRollupRyg() uses. */
function mxMetricStatus(pass, total, def) {
  if (!total) return "good";                 // nothing to score -> nothing to flag
  const ratio = pass / total;
  if (ratio >= (def.green || 1)) return "good";
  if (ratio >= (def.yellow || 0)) return "warn";
  return "issue";
}

/* =========================================================================
   At-a-glance dashboard cards. Each card carries a number, a tiny visual, and a
   data-target pointing at the detail section it scrolls to.
   ========================================================================= */
function mxRenderDashboardCards(host, r, err, daily, consolCount) {
  host.innerHTML = "";

  if (err || !r) {
    host.appendChild(el(`<div class="mx-empty">Window metrics unavailable: ${esc(err || "no data")}.</div>`));
  }

  const money0 = (n) => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

  // Two distinct groups:
  //  • metricCards — tied to metric hits we act on (on-time, late, daily updates).
  //    Every one carries a status of good / warn / issue, and is drawn with the
  //    shared green / yellow / red scheme so the whole row reads at a glance.
  //  • infoCards — reference figures (counts, costs, geography). These are never
  //    green / yellow / red; they use neutral navy / orange / steel accents only.
  const metricCards = [];
  const infoCards = [];

  // ---- Metric cards: the full SRF metric set, scored exactly the way the
  //      Christmas Tree scores SRF (delivery timeliness, daily updates, QC,
  //      shipping docs, AWB/BoL tracking, cost accuracy) but for this window.
  //      On-time delivery folds in the late count, so there's no separate
  //      "Late" card — late is just the complement of on-time. ----
  const scores = mxSrfMetricScores(AppState.grid, MetricsUi.start, MetricsUi.end, r, daily);
  for (const s of (scores || [])) {
    const meta = MX_SRF_METRIC_META[s.key] || { title: s.def.label, target: null, noun: "ok" };
    const status = mxMetricStatus(s.pass, s.total, s.def);
    const pct = s.total ? (s.pass / s.total) * 100 : null;
    let sub = pct === null ? "none scored" : `${s.pass}/${s.total} ${meta.noun}`;
    if (s.key === "delivery" && s.late) sub += ` \u00b7 ${s.late} late`;
    metricCards.push({
      key: s.key, target: meta.target, k: meta.title, status,
      v: pct === null ? "—" : pct.toFixed(1) + "%",
      sub,
      viz: mxMiniRing(pct === null ? 100 : pct, MX_STATUS_COLOR[status]),
    });
  }

  if (r) {
    // ---- Info cards ------------------------------------------------------
    infoCards.push({
      target: "mxsec-ontime", k: "Delivered SRFs", v: r.total_delivered, sub: "in window",
      viz: mxMiniBars(r.mode_rows.map((x) => x[1]), MX_COLORS.ink),
    });

    // Shipment contents — scoped to the same delivered, in-window WMTRs above.
    const inv = mxInventoryTotals(AppState.grid, r.delivered_wmtrs);
    infoCards.push({
      target: "mxsec-contents", k: "Line items", v: inv.line_items.toLocaleString("en-US"),
      sub: "distinct, in window",
      viz: mxMiniBars([inv.line_items, Math.max(1, inv.pieces)], MX_COLORS.accent),
    });
    infoCards.push({
      target: "mxsec-contents", k: "Pieces", v: inv.pieces.toLocaleString("en-US"),
      sub: "total qty shipped",
      viz: mxMiniBars([inv.pieces, Math.max(1, inv.line_items)], MX_COLORS.accentSoft),
    });
    infoCards.push({
      target: "mxsec-program", k: "Service cost", v: money0(r.cost_total), sub: "all programs",
      viz: mxMiniBars(r.cost_rows.map((x) => x[2]), MX_COLORS.accent),
    });
    infoCards.push({
      target: "mxsec-program", k: "Cargo value", v: money0(r.value_total), sub: "all programs",
      viz: mxMiniBars(r.value_rows.map((x) => x[2]), MX_COLORS.accentSoft),
    });
    infoCards.push({
      target: "mxsec-dest", k: "Destinations", v: r.location_rows.length,
      sub: r.location_rows.length === 1 ? "country" : "countries",
      viz: mxMiniBars(r.location_rows.map((x) => x[1]), MX_COLORS.accent),
    });
    infoCards.push({
      target: "mxsec-program", k: "CTR programs", v: r.program_count_rows.length, sub: "with WMTRs",
      viz: mxMiniBars(r.program_count_rows.map((x) => x[1]), MX_COLORS.ink),
    });
    infoCards.push({
      target: "mxsec-mode", k: "Shipping modes", v: r.mode_rows.filter((x) => x[1] > 0).length, sub: "in use",
      viz: mxMiniBars(r.mode_rows.map((x) => x[1]), MX_COLORS.ink),
    });
    // Canceled is a status count (excluded from scoring), not a metric hit —
    // so it lives with the info cards and stays neutral.
    infoCards.push({
      target: "mxsec-cancelled", k: "Canceled", v: r.cancelled_count, sub: "WMTRs",
      viz: mxMiniBars([Math.max(0, r.cancelled_count), Math.max(1, r.total_delivered)], MX_COLORS.steel),
    });
  }

  infoCards.push({
    target: "mxsec-consol", k: "Consolidated", v: consolCount,
    sub: consolCount === 1 ? "group" : "groups",
    viz: mxMiniBars([consolCount, Math.max(1, consolCount)], MX_COLORS.steel),
  });

  // ---- Metric row (top) ----
  if (metricCards.length) {
    const mg = el(`<div class="mx-metricgrid"></div>`);
    for (const c of metricCards) {
      // Only metrics with a detail section on this dashboard are clickable
      // (delivery, daily). The rest — QC, docs, tracking, cost — have their full
      // breakdowns in PMR / Required Attachments, so here they're status tiles.
      const tag = c.target ? "button" : "div";
      const attrs = c.target
        ? `type="button" data-target="${c.target}" aria-label="${esc(c.k)}: ${esc(String(c.v))} — ${esc(MX_STATUS_LABEL[c.status] || "")} — open detail"`
        : `role="group" aria-label="${esc(c.k)}: ${esc(String(c.v))} — ${esc(MX_STATUS_LABEL[c.status] || "")}"`;
      mg.appendChild(el(`
        <${tag} class="mx-metric-card is-${c.status}${c.target ? "" : " mx-static"}" ${attrs}>
          <div class="mx-metric-top">
            <span class="mx-metric-k">${esc(c.k)}</span>
            <span class="mx-metric-viz">${c.viz}</span>
          </div>
          <div class="mx-metric-v">${esc(String(c.v))}</div>
          <div class="mx-metric-foot">
            <span class="mx-metric-sub">${esc(c.sub || "")}</span>
            <span class="mx-metric-badge">${esc(MX_STATUS_LABEL[c.status] || "")}</span>
          </div>
        </${tag}>`));
    }
    host.appendChild(mg);
  }

  // ---- Info cards (below) ----
  if (infoCards.length) {
    host.appendChild(el(`<div class="mx-info-head">Reference</div>`));
    const ig = el(`<div class="mx-cardgrid"></div>`);
    for (const c of infoCards) {
      ig.appendChild(el(`
        <button class="mx-card" type="button" data-target="${c.target}" aria-label="${esc(c.k)}: ${esc(String(c.v))} — open detail">
          <div class="mx-card-top">
            <span class="mx-card-k">${esc(c.k)}</span>
            <span class="mx-card-viz">${c.viz}</span>
          </div>
          <div class="mx-card-v">${esc(String(c.v))}</div>
          <div class="mx-card-sub">${esc(c.sub || "")}</div>
        </button>`));
    }
    host.appendChild(ig);
  }
}

/* =========================================================================
   Consolidated shipments

   One panel per consolidation group (a set of requests shipping together under
   a single AWB via "Consol" links), de-duplicated across every member's Linked
   Request List via analyzeConsolidation() in udq.js. Each group shows whether
   its Consol links are fully reciprocal; incomplete ones are also raised in the
   pre-flight banner. Independent of the reporting window above.
   ========================================================================= */
function mxRenderConsolSection(dash) {
  let analysis = { clusters: [], discrepancies: [] };
  try { analysis = (typeof analyzeConsolidation === "function") ? analyzeConsolidation(AppState.grid) : analysis; }
  catch (e) { analysis = { clusters: [], discrepancies: [] }; }
  const clusters = analysis.clusters;

  const incomplete = clusters.filter((c) => !c.complete).length;
  const dateOnly = (v) => String(v || "").split(" ")[0];
  const cc = (v) => (typeof cleanCountry === "function" ? cleanCountry(v || "") : (v || ""));
  const idOf = (w) => String(w || "").toUpperCase().replace(/-SRF$/, "");

  const panel = el(`
    <div class="panel mx-consol" id="mxsec-consol">
      <header>
        <h2>Consolidated shipments</h2>
        <span class="count">${clusters.length} group${clusters.length === 1 ? "" : "s"}${incomplete ? ` · ${incomplete} to review` : ""}</span>
      </header>
      <div class="body" id="mxConsolBody"></div>
    </div>`);
  dash.appendChild(panel);
  const host = panel.querySelector("#mxConsolBody");

  if (!clusters.length) {
    host.appendChild(el(`<div class="hint">No requests in this dataset carry a "Consol" (consolidation) linkage. Consolidated groups appear here when ATLAS links two or more requests that ship together under a single AWB.</div>`));
    return;
  }

  host.appendChild(el(`<div class="hint" style="margin-bottom:12px;">Each group is a set of requests shipping together under one AWB (linkage type <strong>Consol</strong>), collapsed across every member's Linked Request List so a group is listed once. The reciprocity tag flags groups whose members don't all reference each other — those are also raised in the pre-flight banner. Independent of the reporting window above.</div>`));

  clusters.forEach((c, i) => {
    const rows = c.members.map((m) => `
      <tr>
        <td class="mono">${esc(idOf(m.wmtr))}</td>
        <td>${esc(m.program || "—")}</td>
        <td>${esc(m.status || "")}</td>
        <td>${esc(cc(m.dest))}</td>
        <td>${esc(dateOnly(m.nlt))}</td>
        <td>${esc(m.title || "")}${m.inFile ? "" : ` <span style="color:var(--steel);font-size:.85em;">(not in this dataset)</span>`}</td>
      </tr>`).join("");

    const chip = c.complete
      ? `<span class="badge" style="background:rgba(30,127,79,.14);color:#1E7F4F;border:1px solid rgba(30,127,79,.4);">Reciprocal &#10003;</span>`
      : `<span class="badge" style="background:rgba(176,0,0,.12);color:#B00000;border:1px solid rgba(176,0,0,.4);">Needs review</span>`;

    let warnNote = "";
    if (!c.complete) {
      const miss = c.missing
        .map((x) => `${esc(idOf(x.fromWmtr))} &rarr; ${esc(idOf(x.toWmtr))}${x.toInFile ? "" : " (not in dataset)"}`)
        .join("; ");
      warnNote = `<div class="statusline" style="color:#B00000;margin-top:8px;">These requests don't all reference each other, so the consolidation may be incomplete. Missing reciprocal link(s): ${miss}. Verify in ATLAS.</div>`;
    }

    host.appendChild(el(`
      <div class="mx-consol-group" style="margin-bottom:16px;">
        <div class="mx-consol-head" style="display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;margin-bottom:6px;">
          <span style="font-weight:600;">Group ${i + 1}</span>
          <span class="count">${c.members.length} requests &middot; 1 AWB</span>
          <span style="margin-left:auto;">${chip}</span>
        </div>
        <div class="scrollwrap">
          <table class="data">
            <thead><tr>
              <th>WMTR #</th><th>Program</th><th>Status</th><th>Destination</th><th>NLT date</th><th>Request title</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${warnNote}
      </div>`));
  });
}

/* Repaint just the charts/tables region for the current MetricsUi window. */
/* =========================================================================
   Detail sections — one focused renderer per host, so the detail area can be
   laid out in the SAME order as the cards up top and split cleanly into the
   two groups (metric breakdowns vs. reference & detail). Each takes a host it
   fully owns; the caller clears the host before calling.

   Every window-dependent renderer resolves the pmrRun result the same way, so
   they can be called independently (repaint fills each host in place).
   ========================================================================= */

/* Resolve the window result once (uses the caller's precomputed pmrRun when it
   has one, else runs it). Returns { result, runError }. */
function mxResolveResult(precomputed, precomputedErr) {
  let result = precomputed, runError = precomputedErr || "";
  if (!result && !runError) {
    try { result = pmrRun(AppState.grid, MetricsUi.start, MetricsUi.end); }
    catch (e) { runError = e.message || String(e); }
  }
  return { result, runError };
}

/* ---- Data-quality strip (+ run error) — leads the whole detail area ---- */
function mxRenderDataQualityStrip(host, precomputed, precomputedErr) {
  if (MetricsUi._warn) {
    host.appendChild(el(`<div class="panel"><div class="body"><div class="statusline err">${esc(MetricsUi._warn)}</div></div></div>`));
    MetricsUi._warn = "";
  }

  const { result, runError } = mxResolveResult(precomputed, precomputedErr);
  if (runError) {
    host.appendChild(el(`
      <div class="panel"><div class="body">
        <div class="statusline err">Couldn't summarize this Metrics UDQ: ${esc(runError)}</div>
        <div class="hint">This file was recognized as a Metrics UDQ (two or more WMTR records in column A), but a header the metrics summary needs is missing. Make sure it's an unmodified ATLAS metrics export.</div>
      </div></div>`));
    return;
  }
  const r = result;
  if (!r || !(r.total_delivered > 0)) return;

  const _dqRows = {
    nlt: r.no_nlt_rows || [], mode: r.missing_mode_rows || [], unknown_mode: r.unknown_mode_rows || [],
    dest: r.missing_dest_rows || [], program: r.missing_program_rows || [],
  };
  const _dqAct = (cat) => (typeof pmrmxIsIgnored === "function")
    ? _dqRows[cat].filter((row) => !pmrmxIsIgnored(row[0], cat)).length
    : _dqRows[cat].length;
  const aNlt = _dqAct("nlt"), aMode = _dqAct("mode"), aUnk = _dqAct("unknown_mode"),
        aDest = _dqAct("dest"), aProg = _dqAct("program");
  const issuesTrue = r.no_nlt_count + r.missing_mode_count + r.unknown_mode_count +
    r.missing_dest_count + r.missing_program_count;
  const issues = aNlt + aMode + aUnk + aDest + aProg;   // actionable (non-acknowledged)
  const ackedDq = issuesTrue - issues;
  if (issues > 0) {
    host.appendChild(el(`
      <div class="panel mx-dq mx-dq-warn"><div class="body">
        <div class="statusline">${issues} delivered record${issues === 1 ? "" : "s"} have data-quality gaps
        (missing NLT ${aNlt} · missing mode ${aMode} · unknown mode ${aUnk}
        · missing destination ${aDest} · missing program ${aProg})${ackedDq ? ` · ${ackedDq} acknowledged &amp; hidden` : ""}.
        These stay in the delivered total but drop out of the affected breakdown. Open the
        <strong>PMR</strong> tool for the per-record list and fixes.</div>
      </div></div>`));
  } else if (ackedDq > 0) {
    host.appendChild(el(`
      <div class="panel mx-dq mx-dq-ok"><div class="body">
        <div class="statusline">All ${ackedDq} data-quality gap${ackedDq === 1 ? "" : "s"} in this window have been acknowledged &amp; hidden. Manage in “Ignored”.</div>
      </div></div>`));
  } else {
    host.appendChild(el(`
      <div class="panel mx-dq mx-dq-ok"><div class="body">
        <div class="statusline">All ${r.total_delivered} delivered record${r.total_delivered === 1 ? "" : "s"} are fully populated — no data-quality gaps in this window.</div>
      </div></div>`));
  }
}

/* ---- Metric-group section 1: On-time performance + late deliveries ---- */
function mxRenderOntimeSection(host, precomputed, precomputedErr) {
  const { result: r, runError } = mxResolveResult(precomputed, precomputedErr);
  if (runError || !r) return;

  host.appendChild(el(`
    <div class="panel" id="mxsec-ontime">
      <header><h2>On-time performance</h2><span class="count">${r.nlt_scoped} scored${r.nlt_exempt ? ` · ${r.nlt_exempt} excluded` : ""}</span></header>
      <div class="body mx-donutwrap">
        ${mxOnTimeDonutSvg(r)}
        <ul class="mx-legend">
          <li><span class="mx-dot" style="background:${MX_COLORS.green}"></span>On time <b>${r.on_time_count}</b></li>
          <li><span class="mx-dot" style="background:${MX_COLORS.red}"></span>Late <b>${r.late_count}</b></li>
          <li><span class="mx-dot" style="background:${MX_COLORS.steel}"></span>Missing NLT <b>${r.no_nlt_count}</b></li>
        </ul>
      </div>
      ${r.nlt_exempt ? `<div class="hint" style="padding:0 16px 12px;">${r.nlt_exempt} delivered SRF${r.nlt_exempt === 1 ? " is" : "s are"} excluded from on-time scoring — delivered before ${mxIsoToDmy(r.nlt_cutoff)}, for which TTI was relieved of the NLT requirement. They still count in all other metrics.</div>` : ""}
    </div>`));

  const lateBody = r.late_rows.length
    ? r.late_rows.map((row) => `
        <tr>
          <td class="mono">${esc(row[0])}</td>
          <td>${esc(row[1])}</td>
          <td>${esc(row[2])}</td>
          <td class="num">${esc(row[3])}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" style="color:var(--steel)">No late deliveries in this window.</td></tr>`;

  host.appendChild(el(`
    <div class="panel" id="mxsec-late">
      <header><h2>Late deliveries (delivered after NLT)</h2><span class="count">${r.late_rows.length} late · ${r.nlt_scoped ? r.on_time_pct.toFixed(1) + "% on time" : "—"}</span></header>
      <div class="body">
        <div class="scrollwrap" style="max-height:300px;">
          <table class="data">
            <thead><tr><th>WMTR Number</th><th>NLT Completion Date</th><th>Delivery Date</th><th>Days late</th></tr></thead>
            <tbody>${lateBody}</tbody>
          </table>
        </div>
      </div>
    </div>`));
}

/* =========================================================================
   Row-sourced per-WMTR pass/fail detail for the QC / tracking / cost metric
   sections. Uses the SAME metric defs (XT_ROLLUP_METRICS) and the SAME window
   filters (delivered date in window, shared Oct-1 relief) that
   mxSrfMetricScores() uses for the cards, so a section's pass/total can never
   disagree with its card. Returns { qc, tracking, cost_srf } where each slot is
   { def, pass, total, fails:[row,...] }.
   ========================================================================= */
function mxRowMetricDetail(grid, startIso, endIso) {
  const keys = ["qc", "tracking", "cost_srf"];
  const defByKey = {};
  if (typeof XT_ROLLUP_METRICS !== "undefined") {
    for (const m of XT_ROLLUP_METRICS) if (keys.indexOf(m.key) !== -1) defByKey[m.key] = m;
  }
  const out = {};
  for (const k of keys) out[k] = { def: defByKey[k] || null, pass: 0, total: 0, fails: [] };
  if (!grid || typeof xtParseRecords !== "function" || typeof xtBuildRow !== "function") return out;

  const inWin = (iso) => !!iso && (!startIso || iso >= startIso) && (!endIso || iso <= endIso);
  const relieved = (w, iso) => (typeof pmrSrfRelieved === "function") && pmrSrfRelieved(w, iso);

  let parsed = null;
  try { parsed = xtParseRecords(grid, "SRF"); } catch (e) { parsed = null; }
  for (const rec of (parsed ? parsed.records : [])) {
    let row; try { row = xtBuildRow(rec); } catch (e) { continue; }
    if (!row.delivered) continue;
    const dIso = xtIso(row.delivered);
    if (!inWin(dIso)) continue;
    if (relieved(row.wmtr_full, dIso)) continue;
    for (const k of keys) {
      const m = defByKey[k]; if (!m) continue;
      if (!m.elig(row)) continue;
      out[k].total += 1;
      if (m.pass(row)) out[k].pass += 1;
      else out[k].fails.push(row);
    }
  }
  return out;
}

/* Shared shell for a scored metric section: a RYG-tinted panel whose header
   carries the pass/total + percentage + status badge, and whose body is a
   table listing the failing WMTRs (or an all-clear note). */
function mxMetricSectionShell(host, opts) {
  const slot = opts.slot || { def: null, pass: 0, total: 0, fails: [] };
  const total = slot.total, pass = slot.pass, fails = slot.fails || [];
  const pct = total ? (pass / total) * 100 : null;
  const status = slot.def ? mxMetricStatus(pass, total, slot.def) : "good";
  const countTxt = total
    ? `${pass}/${total} ${esc(opts.passVerb)} · ${pct.toFixed(1)}%`
    : "none scored in window";
  const badge = `<span class="mx-secbadge is-${status}">${esc(MX_STATUS_LABEL[status] || "")}</span>`;
  const body = fails.length
    ? fails.map(opts.rowHtml).join("")
    : `<tr><td colspan="${opts.colspan}" style="color:var(--steel)">${esc(opts.emptyMsg)}</td></tr>`;
  host.appendChild(el(`
    <div class="panel mx-metric-sec is-${status}" id="${opts.id}">
      <header><h2>${esc(opts.title)}</h2><span class="count">${countTxt} ${badge}</span></header>
      <div class="body">
        ${opts.note ? `<div class="hint" style="margin-bottom:10px;">${opts.note}</div>` : ""}
        <div class="scrollwrap" style="max-height:320px;">
          <table class="data">
            <thead><tr>${opts.thead}</tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>
    </div>`));
}

const _mxIdOf = (w) => String(w || "").toUpperCase().replace(/-SRF$/, "");
function _mxDeliveredDmy(row) { try { return mxIsoToDmy(xtIso(row.delivered)); } catch (e) { return ""; } }

/* ---- Metric-group section 3: WMTR Workflow QC ---- */
function mxRenderQcSection(host, detail) {
  const slot = detail && detail.qc;
  mxMetricSectionShell(host, {
    id: "mxsec-qc", title: "WMTR Workflow QC", slot, passVerb: "passed", colspan: 3,
    note: "Delivered SRFs in this window that were rejected in or after Compliance Review — a QC bust. Every delivered WMTR is scored; only the busts are listed below.",
    thead: "<th>WMTR #</th><th>Delivery date</th><th>Rejection reason</th>",
    emptyMsg: (slot && slot.total) ? "No QC rejections in this window — every delivered WMTR passed." : "No delivered WMTRs in this window.",
    rowHtml: (row) => `
      <tr>
        <td class="mono">${esc(_mxIdOf(row.wmtr_full))}</td>
        <td>${esc(_mxDeliveredDmy(row))}</td>
        <td>${esc((slot && slot.def) ? slot.def.failReason(row) : (row.reject_reason || "Rejected during/after Compliance Review"))}</td>
      </tr>`,
  });
}

/* ---- Metric-group section 5: Tracking (AWB/BoL) ---- */
function mxRenderTrackingSection(host, detail) {
  const slot = detail && detail.tracking;
  const cutoff = (typeof XT_TRACKING_CUTOFF_ISO !== "undefined") ? mxIsoToDmy(XT_TRACKING_CUTOFF_ISO) : "Mar 2026";
  mxMetricSectionShell(host, {
    id: "mxsec-tracking", title: "Tracking (AWB/BoL)", slot, passVerb: "with tracking", colspan: 3,
    note: `Delivered SRFs in this window with no value in the AWB/BoL field. The field was added to ATLAS in Feb 2026, so only deliveries on or after ${cutoff} are held to it; earlier ones aren't scored.`,
    thead: "<th>WMTR #</th><th>Delivery date</th><th>Carrier</th>",
    emptyMsg: (slot && slot.total) ? "Every eligible delivery in this window has an AWB/BoL value." : "No eligible deliveries in this window — all were delivered before the AWB/BoL field existed.",
    rowHtml: (row) => `
      <tr>
        <td class="mono">${esc(_mxIdOf(row.wmtr_full))}</td>
        <td>${esc(_mxDeliveredDmy(row))}</td>
        <td>${esc(row.tracking_carrier || "—")}</td>
      </tr>`,
  });
}

/* ---- Metric-group section 6: Cost accuracy ---- */
function mxRenderCostSection(host, detail) {
  const slot = detail && detail.cost_srf;
  const money = (n) => (n == null || n === "") ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  mxMetricSectionShell(host, {
    id: "mxsec-cost", title: "Cost accuracy", slot, passVerb: "within 10%", colspan: 4,
    note: "Delivered SRFs in this window whose approved cost estimate differs from the actual (current Total Cost) by more than 10%. Only WMTRs that carry an approved estimate are scored.",
    thead: "<th>WMTR #</th><th class=\"num\">Approved estimate</th><th class=\"num\">Actual cost</th><th class=\"num\">Variance</th>",
    emptyMsg: (slot && slot.total) ? "Every scored estimate in this window is within 10% of actual." : "No WMTRs with an approved estimate in this window.",
    rowHtml: (row) => {
      const v = row.est_vs_actual;
      const pctTxt = (typeof v === "number") ? ((v > 0 ? "+" : "") + Math.round(v * 100) + "%") : "—";
      return `
      <tr>
        <td class="mono">${esc(_mxIdOf(row.wmtr_full))}</td>
        <td class="num">${money(row.approved_amount)}</td>
        <td class="num">${money(row.current_total_cost)}</td>
        <td class="num">${esc(pctTxt)}</td>
      </tr>`;
    },
  });
}

/* ---- Metric-group section 4: Shipping docs (embedded Required Attachments) ----
   The full Required Attachments window, moved here from the left menu. It keeps
   its own fiscal-period picker (independent of the reporting window above), so
   it's rendered once and never repainted. On a Metrics UDQ renderReqattWorkspace
   draws the multi-WMTR period view; the single-WMTR audit still lives on the
   rail for SRF UDQs. */
function mxRenderDocsSection(host) {
  const wrap = el(`<div id="mxsec-docs" class="mx-docs-embed"></div>`);
  host.appendChild(wrap);
  if (typeof renderReqattWorkspace === "function") {
    try { renderReqattWorkspace(wrap); }
    catch (e) {
      wrap.appendChild(el(`<div class="panel"><div class="body"><div class="statusline err">Required Attachments couldn't load: ${esc(e.message || String(e))}</div></div></div>`));
    }
  } else {
    wrap.appendChild(el(`<div class="panel"><div class="body"><div class="statusline err">Required Attachments module not loaded.</div></div></div>`));
  }
}

/* ---- Metric-group section 7: Manual flags (with all-clear fallback) ---- */
function mxRenderManualSection(host) {
  mxRenderManualMetricBox(host);
  // mxRenderManualMetricBox only paints when something is flagged; give the
  // "Manual flags" card a section to land on when everything is clear.
  if (!host.querySelector("#mxsec-manual")) {
    host.appendChild(el(`
      <div class="panel mx-flag-ok" id="mxsec-manual"><div class="body">
        <div class="statusline">No manually-entered metric flags in this dataset. A reviewer can flag a WMTR the utility can't otherwise catch by adding a note to the DTRA-Only Import/Export Comments field.</div>
      </div></div>`));
  }
}

/* ---- Info-group section 1: Shipment contents ---- */
function mxRenderContentsSection(host, precomputed, precomputedErr) {
  const { result: r, runError } = mxResolveResult(precomputed, precomputedErr);
  if (runError || !r) return;
  const inv = mxInventoryTotals(AppState.grid, r.delivered_wmtrs);
  host.appendChild(el(`
    <div class="panel" id="mxsec-contents">
      <header><h2>Shipment contents</h2><span class="count">${inv.wmtrs_with_inventory} of ${r.total_delivered} with inventory</span></header>
      <div class="body">
        <div class="stats">
          <div class="stat"><div class="k">Line items</div><div class="v mono">${inv.line_items.toLocaleString("en-US")}</div></div>
          <div class="stat"><div class="k">Pieces</div><div class="v mono">${inv.pieces.toLocaleString("en-US")}</div></div>
        </div>
        <div class="hint" style="margin-top:10px;">
          Counts cover the ${inv.wmtrs_with_inventory} delivered WMTR${inv.wmtrs_with_inventory === 1 ? "" : "s"}
          with an Inventory List in this reporting window.
          <strong>Line items</strong> counts distinct items — when the same item is listed on several rows
          instead of using the Quantity column, those rows collapse to one (identity = Description + Model/Catalog Number,
          de-duplicated within each WMTR). <strong>Pieces</strong> is the total Quantity shipped, summed across those
          same rows. Package/parent (&ldquo;P&rdquo;) rows — the boxes and pallets themselves — are excluded from both.
        </div>
      </div>
    </div>`));
}

/* ---- Info-group section 2: By CTR program (count + cost + value) ---- */
function mxRenderProgramSection(host, precomputed, precomputedErr) {
  const { result: r, runError } = mxResolveResult(precomputed, precomputedErr);
  if (runError || !r) return;
  const money0 = (n) => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const progRows = mxProgramRows(r);
  const progBars = mxBarsSvg(r.program_count_rows, {
    label: (x) => x[0], value: (x) => x[1], color: MX_COLORS.green,
    rowH: 19, gap: 4, labelW: 120, valW: 56, labelSize: 11, valSize: 10,
  });
  const progTable = progRows.length
    ? progRows.map((p) => `
        <tr>
          <td>${esc(p.program)}</td>
          <td class="num">${p.count}</td>
          <td class="num">$${p.cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td class="num">$${p.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" style="color:var(--steel)">No programs in this window.</td></tr>`;

  host.appendChild(el(`
    <div class="panel" id="mxsec-program">
      <header><h2>By CTR program</h2><span class="count">${r.program_count_total} WMTRs · ${money0(r.cost_total)} cost · ${money0(r.value_total)} value</span></header>
      <div class="body">
        ${progBars}
        <div class="scrollwrap" style="margin-top:12px;max-height:300px;">
          <table class="data">
            <thead><tr><th>CTR Program</th><th>WMTRs</th><th>Service cost (USD)</th><th>Cargo value (USD)</th></tr></thead>
            <tbody>${progTable}</tbody>
          </table>
        </div>
      </div>
    </div>`));
}

/* ---- Info-group section 3: Destinations (chart + table) ---- */
function mxRenderDestSection(host, precomputed, precomputedErr) {
  const { result: r, runError } = mxResolveResult(precomputed, precomputedErr);
  if (runError || !r) return;
  const destChart = mxBarsSvg(r.location_rows, {
    label: (x) => x[0], value: (x) => x[1], color: MX_COLORS.accent,
    rowH: 19, gap: 4, labelW: 120, valW: 56, labelSize: 11, valSize: 10,
  });
  const destBody = r.location_rows.length
    ? r.location_rows.map((row) => `<tr><td>${esc(row[0])}</td><td class="num">${row[1]}</td></tr>`).join("")
    : `<tr><td colspan="2" style="color:var(--steel)">No destinations in this window.</td></tr>`;

  host.appendChild(el(`
    <div class="panel" id="mxsec-dest">
      <header><h2>Completed SRFs by destination</h2><span class="count">${r.location_rows.length} ${r.location_rows.length === 1 ? "country" : "countries"} · ${r.location_total} of ${r.total_delivered}</span></header>
      <div class="body">
        ${destChart}
        <div class="scrollwrap" style="margin-top:12px;max-height:260px;">
          <table class="data"><thead><tr><th>Country of Destination</th><th>SRFs</th></tr></thead><tbody>${destBody}</tbody></table>
        </div>
      </div>
    </div>`));
}

/* ---- Info-group section 4: Shipping mode (chart + table) ---- */
function mxRenderModeSection(host, precomputed, precomputedErr) {
  const { result: r, runError } = mxResolveResult(precomputed, precomputedErr);
  if (runError || !r) return;
  const modeChart = mxBarsSvg(r.mode_rows, {
    label: (x) => x[0], value: (x) => x[1], color: MX_COLORS.ink, keepZero: false,
  });
  const modeBody = r.mode_rows.map((row) => `<tr><td>${esc(row[0])}</td><td class="num">${row[1]}</td></tr>`).join("");

  host.appendChild(el(`
    <div class="panel" id="mxsec-mode">
      <header><h2>SRFs by shipping mode</h2><span class="count">${r.mode_total} of ${r.total_delivered}</span></header>
      <div class="body">
        ${modeChart}
        <div class="scrollwrap" style="margin-top:12px;max-height:260px;">
          <table class="data"><thead><tr><th>Shipping mode</th><th>SRFs</th></tr></thead><tbody>${modeBody}</tbody></table>
        </div>
      </div>
    </div>`));
}

/* ---- Info-group section 5: Canceled WMTRs ---- */
function mxRenderCancelledSection(host, precomputed, precomputedErr) {
  const { result: r, runError } = mxResolveResult(precomputed, precomputedErr);
  if (runError || !r) return;
  const cancelled = r.cancelled_rows || [];
  const cancBody = cancelled.length
    ? cancelled.map((row) => `
        <tr>
          <td class="mono">${esc(String(row[0]).toUpperCase().replace(/-SRF$/, ""))}</td>
          <td>${esc(row[1])}</td>
          <td>${esc(row[2] || "—")}</td>
          <td>${esc(row[3])}</td>
          <td>${esc(row[4])}</td>
        </tr>`).join("")
    : `<tr><td colspan="5" style="color:var(--steel)">No canceled WMTRs in this file.</td></tr>`;

  host.appendChild(el(`
    <div class="panel" id="mxsec-cancelled">
      <header><h2>Canceled WMTRs</h2><span class="count">${cancelled.length} canceled</span></header>
      <div class="body">
        <div class="hint" style="margin-bottom:10px;">Requests with a <strong>Canceled</strong> status. These are reported here only — never counted as delivered or scored for on-time/late, and shown in every view regardless of the selected reporting window.</div>
        <div class="scrollwrap" style="max-height:300px;">
          <table class="data">
            <thead><tr><th>WMTR #</th><th>Status</th><th>Date Submitted</th><th>CTR Program</th><th>Request Title</th></tr></thead>
            <tbody>${cancBody}</tbody>
          </table>
        </div>
      </div>
    </div>`));
}

/* =========================================================================
   Export a summary of all metrics to a multi-sheet .xlsx (plain tables, no
   charts — mirrors the PMR tool's per-section export style). Uses the same
   pmrRun engine and current reporting window, so the figures match the PMR
   tool and the dashboard exactly.
   ========================================================================= */
function mxExportSummary() {
  const status = document.getElementById("mxSummaryStatus");
  const setErr = (m) => { if (status) { status.textContent = m; status.classList.add("err"); } };
  if (status) { status.classList.remove("err"); status.textContent = "Building summary…"; }

  try {
    if (typeof XLSX === "undefined") throw new Error("Spreadsheet library not loaded.");

    const r = pmrRun(AppState.grid, MetricsUi.start, MetricsUi.end);
    const inv = mxInventoryTotals(AppState.grid, r.delivered_wmtrs);
    let daily = null;
    try { daily = (typeof pmrDailyUpdateCheck === "function") ? pmrDailyUpdateCheck(AppState.grid) : null; }
    catch (e) { daily = null; }

    const num = (n) => Number(n || 0);
    const pct2 = (n) => Number((Number(n) || 0).toFixed(2));

    const wb = XLSX.utils.book_new();
    const addSheet = (name, aoa) => {
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      let ncol = 0;
      for (const row of aoa) ncol = Math.max(ncol, row.length);
      const cols = [];
      for (let i = 0; i < ncol; i++) {
        let w = 8;
        for (const row of aoa) { const v = row[i]; if (v != null) w = Math.max(w, String(v).length); }
        cols.push({ wch: Math.min(w + 2, 48) });
      }
      ws["!cols"] = cols;
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    };

    addSheet("Summary", [
      ["ATLAS Metrics Summary"],
      ["File", AppState.fileName || "Metrics UDQ"],
      ["Reporting window", MetricsUi.label || "All time"],
      ["Generated", new Date().toLocaleString()],
      [],
      ["Metric", "Value"],
      ["Delivered SRFs", r.total_delivered],
      ["Line items (distinct, excl. packages)", inv.line_items],
      ["Pieces (total qty, excl. packages)", inv.pieces],
      ["Scored for on-time (on/after " + (r.nlt_cutoff || "2025-10-01") + ")", r.nlt_scoped],
      ["Excluded from on-time (delivered before cutoff)", r.nlt_exempt],
      ["On-time rate (%)", r.nlt_scoped ? pct2(r.on_time_pct) : ""],
      ["On-time target (%)", 100],
      ["On time (count)", r.on_time_count],
      ["Late deliveries", r.late_count],
      ["Missing NLT", r.no_nlt_count],
      ["Service cost (USD)", num(r.cost_total)],
      ["Cargo value (USD)", num(r.value_total)],
      ["Destinations (countries)", r.location_rows.length],
      ["CTR programs", r.program_count_rows.length],
      ["Shipping modes in use", r.mode_rows.filter((x) => x[1] > 0).length],
      ["Daily logs — WMTRs", daily ? daily.with_daily : ""],
      ["Daily logs — flagged (gaps)", daily ? daily.has_gaps : ""],
      ["Daily logs — clean (%)", daily && daily.with_daily ? pct2(daily.compliant_pct) : ""],
      ["Canceled WMTRs", r.cancelled_count],
    ]);

    addSheet("On-Time Performance", [
      ["Status", "Count"],
      ["On time", r.on_time_count],
      ["Late", r.late_count],
      ["Missing NLT", r.no_nlt_count],
      ["Scored total (on/after cutoff)", r.nlt_scoped],
      ["Excluded (delivered before " + (r.nlt_cutoff || "2025-10-01") + ")", r.nlt_exempt],
      [],
      ["On-time rate (%)", r.nlt_scoped ? pct2(r.on_time_pct) : ""],
      ["Target (%)", 100],
    ]);

    addSheet("Late Deliveries",
      [["WMTR Number", "NLT Completion Date", "Delivery Date", "Days Late"],
        ...r.late_rows.map((x) => [x[0], x[1], x[2], x[3]])]);

    addSheet("By Destination",
      [["Country of Destination", "SRF Count"], ...r.location_rows.map((x) => [x[0], x[1]])]);

    addSheet("By Shipping Mode",
      [["Shipping Mode", "SRF Count"], ...r.mode_rows.map((x) => [x[0], x[1]])]);

    addSheet("Cost by Program",
      [["CTR Program", "Request Count", "Total Cost (USD)"],
        ...r.cost_rows.map((x) => [x[0], x[1], num(x[2])])]);

    addSheet("Value by Program",
      [["CTR Program", "Request Count", "Value of Cargo (USD)"],
        ...r.value_rows.map((x) => [x[0], x[1], num(x[2])])]);

    if (daily) {
      addSheet("Daily Update Check", [
        ["WMTR Number", "First Daily Entry", "Last Daily Entry", "Daily Entries",
          "Missing Business Days", "Missing Dates", "Status"],
        ...daily.rows.map((x) =>
          [x.wmtr, x.first, x.last, x.entries, x.missing_count, x.missing.join(", "), x.status]),
      ]);
    }

    addSheet("Canceled WMTRs",
      [["WMTR Number", "Status", "Date Submitted", "CTR Program", "Request Title"],
        ...(r.cancelled_rows || []).map((x) => [x[0], x[1], x[2] || "", x[3], x[4]])]);

    const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    const fname = `Metrics_Summary_${pmrStamp()}.xlsx`;
    pmrDownloadXlsxB64(b64, fname);
    if (status) status.textContent = `\u2705 Downloaded ${fname}`;
  } catch (e) {
    console.error(e);
    setErr(`Export failed: ${e.message}`);
  }
}

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { mxWindowLabel, mxProgramRows };
}
