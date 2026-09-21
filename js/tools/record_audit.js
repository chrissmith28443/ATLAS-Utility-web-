/* =========================================================================
   ATLAS Utility Web — tools/record_audit.js
   "Audit" — the Christmas Tree, run against the ONE shipping record that's
   currently loaded.

   WHAT IT'S FOR
     The Christmas Tree answers "which of Wendy's 400 WMTRs are busting a
     metric?". This answers the other half of the same question: "is THIS
     request clean?" — a close-out checklist the TTI POC who owns the request
     can run before they call it done.

   HOW IT STAYS HONEST
     It does not invent a second set of rules. It parses the loaded SRF UDQ into
     the same record shape the Christmas Tree builds (xtReadWorkflowLogs /
     xtActivityDates / xtReadShippingActivity), runs it through the same
     xtBuildRow + xtRowIssues engine, and reuses reqattAuditSrf for the
     attachment check. Anything the tracker would flag, this flags — with the
     same wording — and nothing else.

     What it ADDS is the other side of each check: the tracker only shows
     failures, but a close-out list also has to say "done", "not due yet" and
     "can't tell from this export". Those states are computed here.

   PER-WMTR ACKNOWLEDGEMENTS
     The Christmas Tree's ignore list (localStorage, request# -> metrics) is
     honored: an acknowledged metric shows as "Acknowledged" rather than a
     failure, so the two views agree. This tool never writes to that list.
   ========================================================================= */

/* State classes. cls drives the chip color; word is what the chip says. */
const RAUD_STATES = {
  fail:    { word: "Action needed", cls: "bad",  rank: 0 },
  due:     { word: "Due soon",      cls: "warn", rank: 1 },
  open:    { word: "Not yet due",   cls: "open", rank: 2 },
  unknown: { word: "No data",       cls: "na",   rank: 3 },
  ack:     { word: "Acknowledged",  cls: "na",   rank: 4 },
  na:      { word: "Not applicable",cls: "na",   rank: 5 },
  ok:      { word: "Clear",         cls: "good", rank: 6 },
};

/* -------------------------------------------------------------------------
   PARSE — the loaded single-WMTR UDQ, in the Christmas Tree's record shape.
   xtParseRecords can't be reused directly: it gates on the trailing service
   tag matching the file it came from, which is meaningless for one record
   pulled up on its own. Everything below the record row is read with the
   tracker's own section readers, so the values can't drift.
   ------------------------------------------------------------------------- */
function raudRecord(grid) {
  if (!grid) return null;
  const maxRow = gridMaxRow(grid);
  let rr = 0;
  for (let r = 2; r <= maxRow; r++) {
    if (typeof xtLooksWmtr === "function" && xtLooksWmtr(gridCell(grid, r, 1))) { rr = r; break; }
  }
  if (!rr) return null;

  const wmtr = norm(gridCell(grid, rr, 1));
  const service = (typeof xtServiceTag === "function" && xtServiceTag(wmtr)) || "SRF";
  const rEnd = maxRow + 1;                              // one record — runs to the end

  const shipMap = buildHeaderMap(grid, 1);
  const S = (header) => { const c = shipMap[normWs(header)]; return c ? gridCell(grid, rr, c) : ""; };

  return {
    service,
    wmtr,
    scalar: {
      ttiPoc:          norm(S("TTI POC Name")),
      redFlag:         norm(S("Red Flag")),
      redFlagComments: norm(S("Red Flag Comments")),
      topRequired:     norm(S("Transfer of Property (TOP) Required?")),
      totalCost:       S("Total Cost in USD"),
      dateSubmitted:   S("Date Submitted"),
      originalRdd:     S("Original RDD"),
      nltCompletion:   S("NLT Completion Date"),
      status:          norm(S("Status")),
      dateCompleted:   S("Date Completed"),
      deliveryDate:    S("Delivery Date"),
      manualMetric:    norm(S("DTRA-Only Import/Export Comments")),
    },
    wfl:           xtReadWorkflowLogs(grid, rr, rEnd),
    lastActivity:  xtLastActivityDate(grid, rr, rEnd, service),
    activityDates: xtActivityDates(grid, rr, rEnd, service),
    shipping:      service === "SRF" ? xtReadShippingActivity(grid, rr, rEnd)
                                     : { carrier: "", awb: "", tracklink: "" },
  };
}

/* -------------------------------------------------------------------------
   THE CHECKLIST
   ------------------------------------------------------------------------- */
function raudMoney(v) {
  return typeof v === "number"
    ? "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "";
}
function raudDate(d) { return d instanceof Date ? xtDisplayDate(d) : ""; }

/**
 * Build the full audit for the loaded grid.
 * Returns { row, rec, checks[], counts{}, relieved, hasWfl } or null.
 */
function raudBuild(grid) {
  const rec = raudRecord(grid);
  if (!rec) return null;

  const row = xtBuildRow(rec);
  const issues = xtRowIssues(row);                       // the tracker's own engine
  const byMetric = {};
  for (const i of issues) (byMetric[i.metric] = byMetric[i.metric] || []).push(i);

  const docs = (row.service === "SRF" && typeof reqattAuditSrf === "function")
    ? reqattAuditSrf(grid) : null;
  const ig = (typeof xtGetIgnores === "function" ? xtGetIgnores() : {})[row.request_no] || [];
  const acked = (m) => ig.indexOf("*") !== -1 || ig.indexOf(m) !== -1;

  const dIso = row.delivered ? xtIso(row.delivered) : null;
  const relieved = typeof pmrSrfRelieved === "function"
    && pmrSrfRelieved(row.wmtr_full, row.service === "SRF" ? dIso : null);
  const hasWfl = rec.wfl.length > 0;

  const checks = [];
  /** Push a check. An issue from the tracker always wins; the ignore list
      downgrades it to "acknowledged" exactly as the tracker would. `context` is
      appended to the tracker's own wording (never replaces it) so a failure
      names the dates/amounts behind it — the tracker's phrasing stays verbatim. */
  const add = (metric, label, fallback, context) => {
    const hits = byMetric[metric];
    let c;
    if (hits && hits.length) {
      const hard = hits.find((h) => h.kind !== "due") || hits[0];
      c = { metric, label, state: hard.kind === "due" ? "due" : "fail", detail: hard.label };
      if (hits.length > 1) c.detail = hits.map((h) => h.label).join("; ");
      const extra = context ? context() : "";
      if (extra) c.detail += " — " + extra;
    } else {
      c = Object.assign({ metric, label }, fallback());
    }
    if (acked(metric) && (c.state === "fail" || c.state === "due")) {
      c.detail = "Acknowledged in the Christmas Tree — " + c.detail;
      c.state = "ack";
    }
    checks.push(c);
    return c;
  };

  /* 1. QC — rejected in or after Compliance Review. */
  add("rejected", "QC — rejected in or after review", () =>
    !hasWfl ? { state: "unknown", detail: "This export carries no Workflow Logs, so the review history can't be read." }
            : { state: "ok", detail: "No rejection in the workflow history." },
    () => row.reject_reason ? `reason given: ${row.reject_reason}` : "");

  /* 2. Manually-entered metric flag (the repurposed DTRA-Only comments field). */
  add("manual", "Manually-entered metric flag", () =>
    ({ state: "ok", detail: "Nobody has flagged this record by hand." }));

  /* 3. Shipping documents attached — reuses the Required Attachments audit. */
  checks.push((function () {
    const label = "Shipping documents attached";
    const base = { metric: "docs", label };
    if (!docs) return Object.assign(base, { state: "na", detail: "Attachment rules apply to shipping (SRF) records only." });
    if (docs.hand_carry) return Object.assign(base, { state: "na", detail: `Shipment mode is ${docs.shipment_as} — no attachment check required.` });
    if (!docs.classifiable) return Object.assign(base, { state: "unknown", detail: "Country of Origin and/or Destination is blank, so the required document set is undefined." });
    if (docs.missing.length) {
      const c = Object.assign(base, {
        state: "fail",
        detail: `Missing ${docs.missing.length} of ${docs.required.length}: ${docs.missing.join(", ")}`,
      });
      if (acked("docs")) { c.detail = "Acknowledged in the Christmas Tree — " + c.detail; c.state = "ack"; }
      return c;
    }
    return Object.assign(base, {
      state: "ok",
      detail: `All ${docs.required.length} required attachment${docs.required.length === 1 ? "" : "s"} present${docs.is_courier ? " (courier — AWB/BoL + POD only)" : ""}.`,
    });
  })());

  /* 4. Shipment tracking (AWB/BoL). Not a tracker row-flag — it lives in the
        rollup — so the rule is mirrored here (same cutoff, same pass test). */
  checks.push((function () {
    const base = { metric: "tracking", label: "Shipment tracking (AWB/BoL)" };
    if (row.service !== "SRF") return Object.assign(base, { state: "na", detail: "Tracking details apply to shipping (SRF) records only." });
    if (row.tracking_awb) {
      const who = row.tracking_carrier ? ` via ${row.tracking_carrier}` : "";
      return Object.assign(base, { state: "ok", detail: `AWB/BoL ${row.tracking_awb}${who}.` });
    }
    if (!row.delivered) return Object.assign(base, { state: "open", detail: "Not shipped/delivered yet — AWB/BoL still to be entered." });
    if (dIso < XT_TRACKING_CUTOFF_ISO) return Object.assign(base, { state: "na", detail: "Delivered before the AWB/BoL field existed in ATLAS — not scored." });
    const c = Object.assign(base, { state: "fail", detail: "No value in the AWB/BoL field." });
    if (acked("tracking")) { c.detail = "Acknowledged in the Christmas Tree — " + c.detail; c.state = "ack"; }
    return c;
  })());

  /* 5. Daily status updates. */
  add("activity", row.service === "PR" ? "TTI POC status checks" : "Daily status updates", () => {
    if (row.delivered) return { state: "na", detail: "Delivered — daily updates are no longer required." };
    if (!rec.activityDates.length) return { state: "open", detail: "No Daily Status History yet — updates haven't started." };
    const last = raudDate(row.last_activity);
    return { state: "ok", detail: `Every business day covered${last ? `; last entry ${last}` : ""}.` };
  }, () => row.last_activity ? `last entry ${raudDate(row.last_activity)}` : "");

  /* 6. Delivery vs. RDD. */
  add("delivery", "Delivery vs. RDD", () => {
    if (!row.delivered) {
      return row.nlt_completion
        ? { state: "open", detail: `Not delivered yet — RDD is ${raudDate(row.nlt_completion)}.` }
        : { state: "open", detail: "Not delivered yet, and no NLT Completion Date (RDD) on the record." };
    }
    if (row.service !== "SRF") return { state: "na", detail: `Completed ${raudDate(row.delivered)} — RDD timeliness is an SRF metric.` };
    if (!row.nlt_completion) return { state: "unknown", detail: `Delivered ${raudDate(row.delivered)}, but the record has no RDD to compare against.` };
    return { state: "ok", detail: `Delivered ${raudDate(row.delivered)}, on or before the ${raudDate(row.nlt_completion)} RDD.` };
  }, () => `delivered ${raudDate(row.delivered)}, RDD was ${raudDate(row.nlt_completion)}`);

  /* 7. Cost against the DTRA-approved amount / estimate accuracy. */
  add("variance_est", row.delivered ? "Estimate vs. actual cost" : "Cost vs. DTRA-approved amount", () => {
    if (row.approved_amount == null)
      return { state: "unknown", detail: hasWfl ? "No DTRA-approved amount recorded on this request yet." : "This export carries no Workflow Logs, so the approved amount can't be read." };
    const cur = raudMoney(row.current_total_cost), appr = raudMoney(row.approved_amount);
    return { state: "ok", detail: `Current ${cur || "—"} against the approved ${appr}${typeof row.est_vs_actual === "number" ? ` (${(row.est_vs_actual * 100).toFixed(1)}%)` : ""}.` };
  }, () => {
    const appr = raudMoney(row.approved_amount), cur = raudMoney(row.current_total_cost);
    return appr ? `approved ${appr}, current cost ${cur || "—"}` : "";
  });

  /* 8. Revised estimate — only when a second approval exists. */
  add("variance_rev", "Revised estimate vs. actual", () => {
    if (row.rev_est_amount == null) return { state: "na", detail: "No revised estimate on this request." };
    return { state: "ok", detail: `Revised ${raudMoney(row.rev_est_amount)} against ${raudMoney(row.current_total_cost) || "—"} actual.` };
  });

  /* 9. PR estimate timeliness — shows only on a PR record. */
  if (row.service === "PR") {
    add("estimate_pr", "Estimate submitted within 3 business days", () =>
      row.pr_est_helper === "On Time"
        ? { state: "ok", detail: `Submitted ${raudDate(row.estimate_submitted)}, due ${raudDate(row.estimate_due_pr)}.` }
        : { state: "open", detail: "Not yet at the estimate stage." });
  }

  /* 10/11. The two close-out milestones. */
  add("rti", "Ready to Invoice", () => {
    if (row.rti_date) {
      const late = row.rti_due && row.rti_date.getTime() > row.rti_due.getTime();
      return { state: "ok", detail: `Stamped ${raudDate(row.rti_date)}${late ? ` — after the ${raudDate(row.rti_due)} due date` : ""}.` };
    }
    if (!row.delivered) return { state: "open", detail: "Clock starts at delivery — 30 business days from the delivery date." };
    return { state: "open", detail: `Due ${raudDate(row.rti_due)} (TTI target ${raudDate(row.tti_rti_due)}).` };
  }, () => `due ${raudDate(row.rti_due)}, TTI target ${raudDate(row.tti_rti_due)}`);

  add("invoiced", "Invoiced", () => {
    if (row.invoiced_date) return { state: "ok", detail: `Invoiced ${raudDate(row.invoiced_date)} — this request is closed.` };
    if (!row.delivered) return { state: "open", detail: "Clock starts at delivery — 45 business days from the delivery date." };
    return { state: "open", detail: `Due ${raudDate(row.invoiced_due)} (TTI target ${raudDate(row.tti_invoiced_due)}).` };
  }, () => `due ${raudDate(row.invoiced_due)}, TTI target ${raudDate(row.tti_invoiced_due)}`);

  /* Safety net: any tracker issue this checklist doesn't have a row for still
     gets surfaced rather than silently dropped. */
  const covered = new Set(checks.map((c) => c.metric));
  for (const i of issues) {
    if (covered.has(i.metric)) continue;
    covered.add(i.metric);
    checks.push({ metric: i.metric, label: (XT_METRIC_LABELS && XT_METRIC_LABELS[i.metric]) || i.metric, state: "fail", detail: i.label });
  }

  const counts = { fail: 0, due: 0, open: 0, unknown: 0, ack: 0, na: 0, ok: 0 };
  for (const c of checks) counts[c.state] = (counts[c.state] || 0) + 1;

  return { rec, row, checks, counts, relieved, hasWfl, docs };
}

/* -------------------------------------------------------------------------
   VIEW
   ------------------------------------------------------------------------- */
const RecordAudit = { audit: null };

function renderRecordAuditWorkspace(container) {
  const a = raudBuild(AppState.grid);
  RecordAudit.audit = a;

  if (!a) {
    container.appendChild(el(`
      <div class="panel">
        <header><h2>Audit</h2></header>
        <div class="body">
          <div class="statusline err">No WMTR row found in this UDQ — nothing to audit.</div>
        </div>
      </div>`));
    return;
  }

  const row = a.row;
  const verdict = a.counts.fail
    ? `<span style="color:var(--warn);font-weight:600">${a.counts.fail} item${a.counts.fail === 1 ? "" : "s"} need${a.counts.fail === 1 ? "s" : ""} action before this request can be closed out.</span>`
    : a.counts.due
      ? `<span style="color:#B8530B;font-weight:600">Nothing overdue, but ${a.counts.due} milestone${a.counts.due === 1 ? " is" : "s are"} coming due.</span>`
      : `<span style="color:var(--cleared,#1a7f37);font-weight:600">Nothing outstanding — every Christmas Tree check this record can answer is clear.</span>`;

  const chip = (state) => {
    const s = RAUD_STATES[state] || RAUD_STATES.na;
    return `<span class="raud-chip ${s.cls}">${s.word}</span>`;
  };

  const rows = a.checks.map((c) => `
    <tr class="raud-${(RAUD_STATES[c.state] || RAUD_STATES.na).cls}">
      <td class="raud-state">${chip(c.state)}</td>
      <td class="raud-label">${esc(c.label)}</td>
      <td class="raud-detail">${esc(c.detail)}</td>
    </tr>`).join("");

  const redFlag = row.red_flag
    ? `<div class="statusline err" style="margin-bottom:8px;"><strong>Red Flag:</strong> ${esc(row.red_flag)}</div>` : "";
  const topNote = row.top_required === "Yes"
    ? `<div class="statusline" style="margin-bottom:8px;">Transfer of Property is marked <strong>required</strong> on this request — the TOP documents belong in the close-out packet.</div>` : "";
  const reliefNote = a.relieved
    ? `<div class="statusline" style="margin-bottom:8px;">This record was delivered before the 1 Oct 2025 measurement cutoff, so the Christmas Tree treats it as historical and doesn't score it. The checks below still run, for reference.</div>` : "";
  const wflNote = a.hasWfl ? ""
    : `<div class="statusline" style="margin-bottom:8px;">This export has no <strong>Workflow Logs</strong> section, so review dates, the approved amount and the Ready-to-Invoice / Invoiced stamps can't be read. Those checks show as “No data” rather than failures.</div>`;

  const panel = el(`
    <div class="panel">
      <style>
        .raud-summary{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
        .raud-chip{font-family:var(--disp);text-transform:uppercase;letter-spacing:.5px;font-size:10px;font-weight:600;padding:2px 7px;border-radius:var(--radius-badge);border:1px solid currentColor;white-space:nowrap}
        .raud-chip.bad{color:var(--warn)}
        .raud-chip.warn{color:#B8530B}
        .raud-chip.good{color:var(--cleared,#1a7f37)}
        .raud-chip.open{color:var(--steel)}
        .raud-chip.na{color:var(--steel);opacity:.75}
        table.raud td{vertical-align:top;padding:7px 10px;border-bottom:1px solid var(--line)}
        table.raud tr.raud-bad{background:#FDECEC}
        table.raud tr.raud-warn{background:#FEF7DC}
        body.theme-dark table.raud tr.raud-bad{background:#2a1a1c}
        body.theme-dark table.raud tr.raud-warn{background:#2a2612}
        table.raud tr.raud-na{color:var(--steel)}
        td.raud-state{width:120px}
        td.raud-label{width:250px;font-weight:600}
        td.raud-detail{font-size:12.5px}
      </style>
      <header>
        <h2>Audit — Close-out Checklist</h2>
        <span class="count">${esc(row.wmtr_full || "")}</span>
      </header>
      <div class="body">
        <div class="note">
          Runs the Christmas Tree's checks against this one request, so the TTI POC who owns it can see
          what's still outstanding before calling it done. Every failure uses the same rule — and the same
          wording — the tracker would use, so the two can't disagree. Acknowledgements you've made in the
          Christmas Tree are honored here.
        </div>

        <div class="stats" style="margin-bottom:10px;">
          <div class="stat"><div class="k">TTI POC</div><div class="v">${esc(row.tti_poc || "—")}</div></div>
          <div class="stat"><div class="k">Status</div><div class="v">${esc(row.current_status || "—")}</div></div>
          <div class="stat"><div class="k">Action</div><div class="v">${esc(row.action_required || "—")}</div></div>
          <div class="stat"><div class="k">Submitted</div><div class="v">${esc(raudDate(row.submitted_date) || "—")}</div></div>
          <div class="stat"><div class="k">RDD</div><div class="v">${esc(raudDate(row.nlt_completion) || "—")}</div></div>
          <div class="stat"><div class="k">${row.service === "SRF" ? "Delivered" : "Completed"}</div><div class="v">${esc(raudDate(row.delivered) || "Not yet")}</div></div>
          <div class="stat"><div class="k">Current cost</div><div class="v">${esc(raudMoney(row.current_total_cost) || "—")}</div></div>
        </div>

        ${redFlag}${reliefNote}${wflNote}${topNote}

        <div class="raud-summary">
          ${a.counts.fail ? `<span class="raud-chip bad">${a.counts.fail} action needed</span>` : ""}
          ${a.counts.due ? `<span class="raud-chip warn">${a.counts.due} due soon</span>` : ""}
          ${a.counts.open ? `<span class="raud-chip open">${a.counts.open} not yet due</span>` : ""}
          ${a.counts.ack ? `<span class="raud-chip na">${a.counts.ack} acknowledged</span>` : ""}
          ${a.counts.unknown ? `<span class="raud-chip na">${a.counts.unknown} no data</span>` : ""}
          ${a.counts.ok ? `<span class="raud-chip good">${a.counts.ok} clear</span>` : ""}
        </div>
        <div class="statusline">${verdict}</div>

        <div class="scrollwrap" style="margin-top:8px;">
          <table class="data raud"><tbody>${rows}</tbody></table>
        </div>

        <div class="btnrow" style="margin-top:10px;">
          <button class="btn ghost" id="raudCopy">Copy</button>
          <button class="btn ghost" id="raudExport">Export (.xlsx)</button>
          <span class="statusline" id="raudMsg"></span>
        </div>
      </div>
    </div>`);
  container.appendChild(panel);

  panel.querySelector("#raudCopy").addEventListener("click", copyRecordAudit);
  panel.querySelector("#raudExport").addEventListener("click", exportRecordAudit);
}

function raudSummaryLines(a) {
  const row = a.row;
  const lines = [
    `Close-out audit: ${row.wmtr_full}`,
    `TTI POC: ${row.tti_poc || "—"}`,
    `Status: ${row.current_status || "—"}  |  Action: ${row.action_required || "—"}`,
    `Submitted: ${raudDate(row.submitted_date) || "—"}  |  RDD: ${raudDate(row.nlt_completion) || "—"}  |  ${row.service === "SRF" ? "Delivered" : "Completed"}: ${raudDate(row.delivered) || "Not yet"}`,
    "",
  ];
  if (row.red_flag) lines.push(`RED FLAG: ${row.red_flag}`, "");
  for (const c of a.checks) {
    lines.push(`${(RAUD_STATES[c.state] || RAUD_STATES.na).word}\t${c.label}\t${c.detail}`);
  }
  lines.push("");
  lines.push(a.counts.fail
    ? `${a.counts.fail} item(s) need action before close-out.`
    : "Nothing outstanding — every check this record can answer is clear.");
  return lines;
}

function copyRecordAudit() {
  const a = RecordAudit.audit; if (!a) return;
  raudClip(raudSummaryLines(a).join("\n"), "Audit copied to clipboard.");
}

function raudClip(text, okMsg) {
  const msg = document.getElementById("raudMsg");
  const done = () => { if (msg) msg.textContent = okMsg; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}

function exportRecordAudit() {
  const a = RecordAudit.audit; const msg = document.getElementById("raudMsg");
  if (!a) return;
  msg.classList.remove("err");
  try {
    const aoa = [["WMTR", a.row.wmtr_full], ["TTI POC", a.row.tti_poc || ""],
      ["Status", a.row.current_status || ""], ["Action Required", a.row.action_required || ""],
      ["Submitted", raudDate(a.row.submitted_date)], ["RDD", raudDate(a.row.nlt_completion)],
      [a.row.service === "SRF" ? "Delivered" : "Completed", raudDate(a.row.delivered)],
      [], ["Result", "Check", "Detail"]];
    for (const c of a.checks) aoa.push([(RAUD_STATES[c.state] || RAUD_STATES.na).word, c.label, c.detail]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 16 }, { wch: 40 }, { wch: 80 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Close-out Audit");
    const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    const tag = wmtrLast5(a.row.wmtr_full) ? `_${wmtrLast5(a.row.wmtr_full)}` : "";
    pmrDownloadXlsxB64(b64, `Close-out Audit${tag}_${fileStamp()}.xlsx`);
    msg.textContent = "Exported.";
  } catch (e) {
    console.error(e);
    msg.textContent = `Export failed: ${e.message}`;
    msg.classList.add("err");
  }
}

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { raudRecord, raudBuild };
}
