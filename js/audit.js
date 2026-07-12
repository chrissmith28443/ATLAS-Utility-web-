/* =========================================================================
   ATLAS Utility Web — audit.js
   Run history / audit log (Feature #7).

   Records every document the app generates, so there's a traceable history of
   what was produced and when. Two capture paths:
     1) A single global hook on programmatic downloads (any <a download> click)
        — automatically logs every .xlsx / .zip / .docx / .html / .csv the tools
        produce, with no per-tool changes.
     2) Explicit record() calls in the print-to-PDF paths (CI, PO, Placards, and
        the merged packet), since those open a print window rather than download.

   IMPORTANT DURABILITY NOTE: history is stored in this browser's localStorage,
   so it is per-browser and can be wiped by clearing site data. It is NOT a
   tamper-proof audit trail. For real record-keeping, use Export (CSV/JSON) in
   the History panel to save a durable copy off the machine.
   ========================================================================= */

const AuditLog = {
  KEY: "atlas.history",
  MAX: 500,
  _data: null,

  load() {
    if (this._data) return this._data;
    let a = [];
    try { a = JSON.parse(localStorage.getItem(this.KEY) || "[]"); } catch (e) { a = []; }
    this._data = Array.isArray(a) ? a : [];
    return this._data;
  },
  all() { return this.load(); },
  record(entry) {
    const a = this.load();
    const e = Object.assign({
      id: Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
      ts: new Date().toISOString(),
    }, entry || {});
    a.unshift(e);
    if (a.length > this.MAX) a.length = this.MAX;
    this._data = a;
    try { localStorage.setItem(this.KEY, JSON.stringify(a)); } catch (e2) { /* storage off */ }
    return e;
  },
  clear() {
    this._data = [];
    try { localStorage.removeItem(this.KEY); } catch (e) { /* ignore */ }
  },
};

/* ---- filename → metadata helpers ---- */

function _auditFmtFromName(name) {
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".xlsx") || n.endsWith(".xlsm")) return "Excel";
  if (n.endsWith(".zip")) return "ZIP";
  if (n.endsWith(".docx")) return "Word";
  if (n.endsWith(".pdf")) return "PDF";
  if (n.endsWith(".html")) return "HTML";
  if (n.endsWith(".csv")) return "CSV";
  if (n.endsWith(".eml")) return "Email";
  return "File";
}

const _AUDIT_TYPE_PREFIXES = [
  ["Packet_", "Document Packet"],
  ["CI_", "Commercial Invoice"],
  ["PL_", "Packing List"],
  ["SLI_", "Shipper's Letter of Instruction"],
  ["IPC_", "Inventory Packing Checklist"],
  ["Placards_", "Placards"],
  ["RFQ_", "Request for Quote"],
  ["DD1149", "DD Form 1149"],
  ["TOP", "TOP Documents"],
  ["CoreIMS", "CoreIMS Import"],
  ["Export_Controlled", "Export-Controlled Materials"],
  ["PMR", "PMR"],
  ["Metrics", "Metrics"],
  ["Property_Purchase_Order", "Purchase Order (Property)"],
  ["PO_", "Purchase Order"],
  ["MCT", "MCT Entry Letter"],
  ["IPC", "Inventory Packing Checklist"],
];

function _auditTypeFromName(name) {
  const n = String(name || "");
  for (const [p, label] of _AUDIT_TYPE_PREFIXES) if (n.indexOf(p) === 0) return label;
  for (const [p, label] of _AUDIT_TYPE_PREFIXES) if (n.indexOf(p) > -1) return label;
  return "Document";
}

function _auditWmtr(name) {
  const m = String(name || "").match(/(?:^|\D)(1\d{4})(?:\D|$)/);
  return m ? m[1] : "";
}

/* ---- global download hook: log any <a download> click ---- */
(function () {
  if (typeof HTMLAnchorElement === "undefined" || HTMLAnchorElement.prototype.__atlasAudit) return;
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try {
      const dl = this.getAttribute && this.getAttribute("download");
      const skip = this.dataset && this.dataset.auditSkip;
      if (dl && !skip) {
        AuditLog.record({
          kind: "download",
          filename: dl,
          type: _auditTypeFromName(dl),
          format: _auditFmtFromName(dl),
          wmtr: _auditWmtr(dl),
        });
      }
    } catch (e) { /* never let logging break a download */ }
    return orig.apply(this, arguments);
  };
  HTMLAnchorElement.prototype.__atlasAudit = true;
})();

/** Convenience for print-to-PDF paths (no download anchor fires). */
function auditRecordPrint(type, filename, wmtr) {
  try {
    AuditLog.record({ kind: "print", type, filename, format: "PDF (print)", wmtr: wmtr || _auditWmtr(filename) });
  } catch (e) { /* ignore */ }
}

/* =========================================================================
   History modal
   ========================================================================= */

const HISTORY_STYLE = `
  .hist-overlay{position:fixed;inset:0;background:rgba(12,18,28,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:5vh 16px;overflow:auto;}
  .hist-dialog{background:var(--card);color:inherit;border:1px solid var(--line);border-radius:12px;max-width:760px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.3);}
  .hist-dialog header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);}
  .hist-dialog header h2{margin:0;font-family:var(--disp);}
  .hist-dialog header .x{margin-left:auto;background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:var(--steel);}
  .hist-body{padding:14px 18px;}
  .hist-note{color:var(--steel);font-size:.8rem;margin-bottom:10px;}
  .hist-scroll{max-height:55vh;overflow:auto;}
  .hist-empty{color:var(--steel);padding:20px 0;text-align:center;}
  .hist-foot{display:flex;align-items:center;gap:10px;padding:14px 18px;border-top:1px solid var(--line);}
  .hist-foot .spacer{margin-left:auto;}
  table.hist-table{width:100%;border-collapse:collapse;font-size:.85rem;}
  table.hist-table th,table.hist-table td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--line);vertical-align:top;}
  table.hist-table th{font:600 .72rem/1 var(--disp);letter-spacing:.04em;text-transform:uppercase;color:var(--steel);position:sticky;top:0;background:var(--card);}
  table.hist-table td.mono{font-family:var(--mono);font-size:12px;}
`;

function _histFmtTime(ts) {
  try { return new Date(ts).toLocaleString(); } catch (e) { return ts || ""; }
}

function openHistory() {
  closeHistory();
  const overlay = el(`
    <div class="hist-overlay" id="histOverlay">
      <div class="hist-dialog" role="dialog" aria-modal="true" aria-label="Run history">
        <style>${HISTORY_STYLE}</style>
        <header>
          <h2>Run history</h2>
          <button class="x" id="histClose" title="Close" aria-label="Close">×</button>
        </header>
        <div class="hist-body">
          <div class="hist-note">A record of documents generated in this browser. Stored locally — export to keep a durable copy.</div>
          <div class="hist-scroll" id="histScroll"></div>
        </div>
        <div class="hist-foot">
          <button class="btn ghost" id="histClear">Clear history</button>
          <span class="spacer"></span>
          <button class="btn ghost" id="histCsv">Export CSV</button>
          <button class="btn ghost" id="histJson">Export JSON</button>
          <button class="btn" id="histCloseBtn">Close</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(overlay);

  const close = () => closeHistory();
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#histClose").addEventListener("click", close);
  overlay.querySelector("#histCloseBtn").addEventListener("click", close);
  document.addEventListener("keydown", _histEscHandler);

  overlay.querySelector("#histClear").addEventListener("click", () => {
    if (window.confirm("Clear the entire run history? This cannot be undone.")) {
      AuditLog.clear();
      _histRenderBody(overlay.querySelector("#histScroll"));
    }
  });
  overlay.querySelector("#histCsv").addEventListener("click", _histExportCsv);
  overlay.querySelector("#histJson").addEventListener("click", _histExportJson);

  _histRenderBody(overlay.querySelector("#histScroll"));
}

function _histRenderBody(scroll) {
  if (!scroll) return;
  const rows = AuditLog.all();
  if (!rows.length) {
    scroll.innerHTML = `<div class="hist-empty">No documents generated yet.</div>`;
    return;
  }
  scroll.innerHTML = `
    <table class="hist-table">
      <thead><tr><th>Time</th><th>Type</th><th>Format</th><th>File</th><th>WMTR</th><th>Note</th></tr></thead>
      <tbody>
        ${rows.map((e) => `
          <tr>
            <td>${esc(_histFmtTime(e.ts))}</td>
            <td>${esc(e.type || "Document")}</td>
            <td>${esc(e.format || "")}</td>
            <td class="mono">${esc(e.filename || "")}</td>
            <td class="mono">${esc(e.wmtr || "")}</td>
            <td>${esc(e.note || "")}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function _histDownloadText(text, filename, mime) {
  const a = document.createElement("a");
  a.href = `data:${mime};charset=utf-8,` + encodeURIComponent(text);
  a.download = filename;
  a.dataset.auditSkip = "1"; // don't log the export itself
  document.body.appendChild(a); a.click();
  setTimeout(() => document.body.removeChild(a), 500);
}

function _histExportCsv() {
  const rows = AuditLog.all();
  const cols = ["ts", "type", "format", "filename", "wmtr", "kind", "note"];
  const head = ["Timestamp", "Type", "Format", "File", "WMTR", "Action", "Note"];
  const escCsv = (v) => {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.join(",")];
  for (const e of rows) lines.push(cols.map((c) => escCsv(e[c])).join(","));
  _histDownloadText(lines.join("\r\n"), `ATLAS_History_${fileStamp()}.csv`, "text/csv");
}

function _histExportJson() {
  _histDownloadText(JSON.stringify(AuditLog.all(), null, 2), `ATLAS_History_${fileStamp()}.json`, "application/json");
}

function closeHistory() {
  const o = document.getElementById("histOverlay");
  if (o) o.remove();
  document.removeEventListener("keydown", _histEscHandler);
}
function _histEscHandler(e) { if (e.key === "Escape") closeHistory(); }

function initHistoryButton() {
  const btn = document.getElementById("historyBtn");
  if (btn) btn.addEventListener("click", openHistory);
}
document.addEventListener("DOMContentLoaded", initHistoryButton);
