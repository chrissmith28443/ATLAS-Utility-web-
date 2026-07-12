/* =========================================================================
   ATLAS Utility Web — packet.js
   "Generate packet" batch action (Feature #2).

   One click: pick which shipping documents to include, choose a signer, then
   produce either:
     (a) ONE merged PDF — every selected document's printable HTML concatenated
         into a single print window (the same crisp, vector print-to-PDF path
         the individual tools already use), or
     (b) a .ZIP of individual files — each document in its NATIVE deliverable
         form: real .xlsx for the Excel docs, print-ready .html for the
         print-to-PDF docs (open → Save as PDF).

   Each document is generated from sensible defaults (today's date, auto CI mode,
   pickup → delivery, etc.). The only per-packet choice is the signer, applied to
   the Commercial Invoice and Packing List. Other defaults — which documents are
   pre-selected, unit system, contract number, CI purpose — come from Settings
   (the gear icon) and persist per browser.

   WHY THIS SHAPE (flagged design decisions):
     * No PDF library is introduced. Every PDF in this app is produced by the
       browser's print-to-PDF (vector, sharp text — important for customs docs).
       A merged PDF therefore concatenates HTML, not PDF bytes; the zip can't
       contain real PDF bytes for the print docs, so they ship as .html.
     * Eligible docs: CI, PL, Placards, IPC — the SRF shipping documents that
       render fully from the UDQ + defaults. PO and MCT (manual / validated
       input), SLI (freight-forwarder selection) and RFQ (email draft) aren't in
       the one-click packet yet.

   Multi-document merge: each *RenderHtml() returns a COMPLETE HTML document with
   its own <style> and @page size (CI landscape, PL/Placards portrait). To merge
   them into one print document without their CSS colliding, each document's
   styles are SCOPED under a per-document wrapper class and its @page is
   re-emitted as a uniquely NAMED page, so Chromium keeps CI landscape while the
   rest stay portrait in the same PDF.
   ========================================================================= */

function _pktName(prefix, data) {
  const last5 = (data && data.meta && data.meta.wmtr_last5) || "UDQ";
  return `${prefix}_${last5}_${fileStamp()}`;
}

/** The signer chosen in the packet (falls back to the saved default). */
function _pktSignerName() {
  const n = document.getElementById("pktSigner");
  if (n) return n.value || "";
  return (typeof AtlasSettings !== "undefined") ? (AtlasSettings.get().packetSigner || "") : "";
}

/* ---- per-document default option builders (settings-aware) ---- */

function _pktCiOpts(data) {
  const m = data.meta;
  const s = (typeof AtlasSettings !== "undefined") ? AtlasSettings.get() : {};
  const signer = (typeof atlasResolveSigner === "function") ? atlasResolveSigner(_pktSignerName()) : null;
  return {
    invoiceDate: todayISO(),
    shipmentDate: "",
    purpose: s.defaultPurpose || ((typeof PURPOSE_CHOICES !== "undefined" && PURPOSE_CHOICES[0]) || "Donation"),
    shipmentRef: "",
    contractNo: m.contract_no || s.defaultContract || (typeof DEFAULT_CONTRACT_NO !== "undefined" ? DEFAULT_CONTRACT_NO : ""),
    shipmentComments: "",
    printedName: signer ? signer.name : "",
    title: signer ? signer.title : "",
    userRemarks: "",
    mode: (typeof ciDetectMode === "function") ? ciDetectMode(m) : "import",
    intConsignee: false,
  };
}

function _pktPlOpts(data) {
  const s = (typeof AtlasSettings !== "undefined") ? AtlasSettings.get() : {};
  const signer = (typeof atlasResolveSigner === "function") ? atlasResolveSigner(_pktSignerName()) : null;
  return {
    unitSystem: s.packetUnit || "imperial",
    shipFrom: "pickup",
    shipTo: "deliver",
    printedName: signer ? `${signer.name}, ${signer.title}` : "",
  };
}

function _pktPlacardsOpts(data) {
  const hasHaz = (typeof _pkHasHazmat === "function") ? _pkHasHazmat(data)
    : (data.items || []).some((it) => normWs(it.un_code) || normWs(it.hazmat_class));
  const fromParty = (typeof _pkResolveParty === "function") ? _pkResolveParty(data, "pickup", "origin") : (data.parties.pickup || makeParty());
  const toParty = (typeof _pkResolveParty === "function") ? _pkResolveParty(data, "deliver", "consignee") : (data.parties.deliver || makeParty());
  const count = (typeof _pkBoxCount === "function") ? _pkBoxCount(data) : 1;
  return {
    fromKey: "pickup", toKey: "deliver", fromParty, toParty,
    count, start: 1, handling: norm((data.meta && data.meta.special_handling) || ""), hazmat: hasHaz,
    fromLabel: "Pickup Location", toLabel: "Delivery Destination",
  };
}

/* ---- document registry ---- */

/** SLI freight/forwarder come from the packet's own dropdowns (which default to
 *  the last-used values saved in Settings). sigDate is today, like the SLI tool. */
function _pktSliOpts(data) {
  const settings = (typeof AtlasSettings !== "undefined") ? AtlasSettings.get() : {};
  const fEl = document.getElementById("pktSliFreight");
  const wEl = document.getElementById("pktSliForward");
  const freightSel = fEl ? fEl.value : (settings.packetSliFreight || "Sovana Global Logistics");
  const forwardSel = wEl ? wEl.value : (settings.packetSliForward || "");
  return { freightSel, forwardSel, sigDate: (typeof todayISO === "function" ? todayISO() : "") };
}

const PACKET_DOCS = [
  {
    id: "ci", label: "Commercial Invoice", kind: "pdf",
    html(data) { return ciRenderHtml(ciBuildPages(data, _pktCiOpts(data)), _pktName("CI", data)); },
    async file(data) { return { name: _pktName("CI", data) + ".html", mime: "text/html", text: this.html(data) }; },
  },
  {
    id: "pl", label: "Packing List", kind: "xlsx",
    html(data) { return plRenderHtml(data, _pktPlOpts(data)); },
    async file(data) {
      if (typeof JSZip === "undefined") throw new Error("JSZip is not available");
      const parts = _plXlsxParts(data, _pktPlOpts(data));
      const zip = new JSZip();
      for (const [name, content] of Object.entries(parts)) zip.file(name, content);
      const b64 = await zip.generateAsync({ type: "base64" });
      return { name: _pktName("PL", data) + ".xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", b64 };
    },
  },
  {
    id: "placards", label: "Placards", kind: "pdf",
    html(data) { return placardsRenderHtml(placardsBuildModel(data, _pktPlacardsOpts(data)), _pktName("Placards", data)); },
    async file(data) { return { name: _pktName("Placards", data) + ".html", mime: "text/html", text: this.html(data) }; },
  },
  {
    id: "ipc", label: "Inventory Packing Checklist", kind: "xlsx",
    html(data) { return ipcRenderHtml(data); },
    async file(data) {
      const b64 = await ipcWriteWorkbook(ipcBuildModel(data));
      return { name: _pktName("IPC", data) + ".xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", b64 };
    },
  },
  {
    id: "sli", label: "Shipper's Letter of Instruction", kind: "xlsx",
    html(data) { return sliRenderHtml(data, _pktSliOpts(data)); },
    async file(data) {
      const b64 = await sliWriteWorkbook(sliBuildModel(data, _pktSliOpts(data)));
      return { name: _pktName("SLI", data) + ".xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", b64 };
    },
  },
];

function _pktDocById(id) { return PACKET_DOCS.find((d) => d.id === id); }

/* ---------------------------------------------------------------------------
   CSS scoper + merge builder  (unit-tested)
   --------------------------------------------------------------------------- */

function _pktSplitDoc(html) {
  let styles = "";
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRe.exec(html))) styles += m[1] + "\n";
  const bodyM = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyM ? bodyM[1] : html;
  return { styles, body };
}

function _pktSplitRules(css) {
  const rules = [];
  const n = css.length;
  let i = 0;
  while (i < n) {
    const brace = css.indexOf("{", i);
    if (brace < 0) break;
    const prelude = css.slice(i, brace).trim();
    let depth = 1, j = brace + 1;
    while (j < n && depth > 0) {
      const c = css[j];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      j++;
    }
    rules.push({ prelude, body: css.slice(brace + 1, j - 1) });
    i = j;
  }
  return rules;
}

function _pktPrefixSelector(sel, scope) {
  sel = sel.trim();
  if (!sel) return "";
  if (/^(html|body|:root)$/i.test(sel)) return scope;
  sel = sel.replace(/^\s*(html|body)\b/i, scope);
  if (sel.indexOf(scope) === 0) return sel;
  if (sel === "*") return `${scope} *`;
  return `${scope} ${sel}`;
}

function _pktScopeCss(css, scope, pageRef) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let out = "";
  for (const { prelude, body } of _pktSplitRules(css)) {
    if (prelude[0] === "@") {
      const at = prelude.split(/\s|\(/)[0].toLowerCase();
      if (at === "@media" || at === "@supports") {
        out += `${prelude}{${_pktScopeCss(body, scope, pageRef)}}`;
      } else if (at === "@page") {
        const sz = body.match(/size\s*:\s*([^;]+)/i);
        const mg = body.match(/margin\s*:\s*([^;]+)/i);
        if (sz) pageRef.size = sz[1].trim();
        if (mg) pageRef.margin = mg[1].trim();
      } else {
        out += `${prelude}{${body}}`;
      }
    } else {
      const seen = new Set();
      const sel = prelude.split(",")
        .map((s) => _pktPrefixSelector(s, scope))
        .filter((s) => s && !seen.has(s) && seen.add(s))
        .join(", ");
      out += `${sel}{${body}}`;
    }
  }
  return out;
}

function packetMergedHtml(docs, titleText) {
  const headParts = [
    "html,body{margin:0;padding:0;background:#fff;}",
    ".pkt-doc{background:#fff;}",
  ];
  const bodyParts = [];
  docs.forEach((d, idx) => {
    const { styles, body } = _pktSplitDoc(d.html);
    const scope = `.pkt-${d.id}`;
    const pageName = `pkt_${d.id}`;
    const pageRef = { size: "8.5in 11in", margin: "0.5in" };
    const scoped = _pktScopeCss(styles, scope, pageRef);
    headParts.push(`@page ${pageName}{ size:${pageRef.size}; margin:${pageRef.margin}; }`);
    headParts.push(scoped);
    const brk = idx > 0 ? "break-before:page;page-break-before:always;" : "";
    bodyParts.push(`<section class="pkt-doc pkt-${d.id}" style="page:${pageName};${brk}">${body}</section>`);
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(titleText || "Shipping packet")}</title>` +
    `<style>${headParts.join("\n")}</style></head><body>${bodyParts.join("\n")}</body></html>`;
}

/* ---------------------------------------------------------------------------
   Workspace UI — one click
   --------------------------------------------------------------------------- */

const PacketUi = { selected: null };

const PACKET_STYLE = `
  .pktwrap .pktrow{display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid var(--line);border-radius:9px;margin-bottom:8px;}
  .pktwrap .pktrow input{width:auto;}
  .pktwrap .pktrow .pkt-label{font-weight:600;}
  .pktwrap .pktrow .pkt-kind{font-size:.72rem;color:var(--steel);border:1px solid var(--line);border-radius:6px;padding:1px 6px;margin-left:auto;white-space:nowrap;}
  .pktwrap .pkt-signer{display:flex;flex-direction:column;gap:4px;max-width:340px;margin-bottom:14px;}
  .pktwrap .pkt-signer label{font-size:.82rem;font-weight:600;}
  .pktwrap .pkt-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:6px;}
  .pktwrap .pkt-count{color:var(--steel);font-size:.85rem;}
  .pktwrap .pkt-sli{border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:9px;padding:11px 13px;margin:2px 0 12px;}
  .pktwrap .pkt-sli .pkt-sli-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px 16px;}
  .pktwrap .pkt-sli .pkt-sli-h{font:600 .72rem var(--disp);letter-spacing:.05em;text-transform:uppercase;color:var(--steel);margin-bottom:8px;}
`;

function _pktInitSelection() {
  if (PacketUi.selected) return;
  const s = (typeof AtlasSettings !== "undefined") ? AtlasSettings.get().packetDocs : null;
  PacketUi.selected = {};
  for (const d of PACKET_DOCS) {
    PacketUi.selected[d.id] = s ? !!s[d.id] : (d.id === "ci" || d.id === "pl" || d.id === "placards");
  }
}

function renderPacketWorkspace(container) {
  if (!AppState.data) {
    container.appendChild(el(`<div class="panel"><div class="body"><div class="note">Load an SRF UDQ to build a packet.</div></div></div>`));
    return;
  }
  _pktInitSelection();
  const defaultSigner = (typeof AtlasSettings !== "undefined") ? AtlasSettings.get().packetSigner : "";
  const setN = (typeof AtlasSettings !== "undefined") ? AtlasSettings.get() : {};
  const locKeys = (typeof SLI_LOCATIONS !== "undefined") ? Object.keys(SLI_LOCATIONS) : [];
  const freightDefault = setN.packetSliFreight || "Sovana Global Logistics";
  const forwardDefault = setN.packetSliForward || "";
  const freightOpts = ['<option value="Other (manual)">Other (manual)</option>']
    .concat(locKeys.map((n) => `<option value="${esc(n)}" ${freightDefault === n ? "selected" : ""}>${esc(n)}</option>`)).join("");
  const forwardOpts = ['<option value="">— Select forwarder —</option>', '<option value="Other (manual)">Other (manual)</option>']
    .concat(locKeys.map((n) => `<option value="${esc(n)}" ${forwardDefault === n ? "selected" : ""}>${esc(n)}</option>`)).join("");

  const rows = PACKET_DOCS.map((d) => `
    <label class="pktrow">
      <input type="checkbox" class="pkt-check" data-id="${d.id}" ${PacketUi.selected[d.id] ? "checked" : ""}>
      <span class="pkt-label">${esc(d.label)}</span>
      <span class="pkt-kind">${d.kind === "pdf" ? "PDF page" : "Excel"}</span>
    </label>`).join("");

  const sliControls = `
    <div class="pkt-sli" id="pktSliControls" style="display:none">
      <div class="pkt-sli-h">SLI details</div>
      <div class="pkt-sli-grid">
        <div class="field">
          <label for="pktSliFreight">Freight location</label>
          <select id="pktSliFreight">${freightOpts}</select>
        </div>
        <div class="field">
          <label for="pktSliForward">Forwarding agent</label>
          <select id="pktSliForward">${forwardOpts}</select>
          <div class="hint">Changes often — choose the right agent for this shipment.</div>
        </div>
      </div>
    </div>`;

  const panel = el(`
    <div class="panel pktwrap">
      <style>${PACKET_STYLE}</style>
      <header><h2>Generate packet</h2><span class="count">${esc(AppState.data.meta.wmtr || "SRF UDQ")}</span></header>
      <div class="body">
        <div class="note">
          Pick the documents and a signer, then build them all at once. <strong>Merged PDF</strong> combines every selected
          document into a single print-to-PDF (each on its own page, CI in landscape). <strong>Download .zip</strong> packages
          each document in its native form — real <span class="mono">.xlsx</span> for the Excel documents and print-ready
          <span class="mono">.html</span> for the PDF documents (open → Save as PDF). Defaults come from
          <a href="#" id="pktOpenSettings">Settings</a>.
        </div>

        <div class="pkt-signer">
          <label for="pktSigner">Signer</label>
          <select id="pktSigner" data-fc-skip>${atlasSignerOptions(defaultSigner)}</select>
        </div>

        ${rows}

        ${sliControls}

        <div class="pkt-actions">
          <button class="btn primary" id="pktPdf">Merged PDF</button>
          <button class="btn" id="pktZip">Download .zip</button>
          <span class="pkt-count" id="pktCount"></span>
        </div>
        <div class="statusline" id="pktStatus" style="margin-top:10px;"></div>
      </div>
    </div>`);
  container.appendChild(panel);

  const updateSliVis = () => {
    const box = panel.querySelector("#pktSliControls");
    if (box) box.style.display = (PacketUi.selected && PacketUi.selected.sli) ? "" : "none";
  };

  const updateCount = () => {
    const n = Object.values(PacketUi.selected).filter(Boolean).length;
    panel.querySelector("#pktCount").textContent = `${n} document${n === 1 ? "" : "s"} selected`;
    panel.querySelector("#pktPdf").disabled = n === 0;
    panel.querySelector("#pktZip").disabled = n === 0;
  };

  panel.querySelectorAll(".pkt-check").forEach((cb) => {
    cb.addEventListener("change", () => { PacketUi.selected[cb.dataset.id] = cb.checked; updateCount(); updateSliVis(); });
  });
  const settingsLink = panel.querySelector("#pktOpenSettings");
  if (settingsLink) settingsLink.addEventListener("click", (e) => { e.preventDefault(); if (typeof openSettings === "function") openSettings(); });
  panel.querySelector("#pktPdf").addEventListener("click", generatePacketPdf);
  panel.querySelector("#pktZip").addEventListener("click", generatePacketZip);
  updateCount();
  updateSliVis();
}

function _pktSelectedDocs() {
  return PACKET_DOCS.filter((d) => PacketUi.selected && PacketUi.selected[d.id]);
}

/** If SLI is in the packet, require a forwarding agent (it changes often, so it
 *  isn't silently pre-selected). On success, remember the choices as defaults. */
function _pktSliGuard(status) {
  if (!(PacketUi.selected && PacketUi.selected.sli)) return true;
  const wEl = document.getElementById("pktSliForward");
  const forward = wEl ? (wEl.value || "") : "";
  if (!forward) {
    if (status) {
      status.textContent = "Choose a forwarding agent for the SLI — it changes often, so it isn't pre-selected.";
      status.classList.add("err");
    }
    return false;
  }
  if (typeof AtlasSettings !== "undefined") {
    const fEl = document.getElementById("pktSliFreight");
    AtlasSettings.save({ packetSliForward: forward, packetSliFreight: fEl ? (fEl.value || "") : "" });
  }
  return true;
}

async function generatePacketPdf() {
  if (typeof atlasGenerateGate === "function" && !atlasGenerateGate("packet", generatePacketPdf)) return;
  const status = document.getElementById("pktStatus");
  status.classList.remove("err");
  const docs = _pktSelectedDocs();
  if (!docs.length) return;
  if (!_pktSliGuard(status)) return;

  status.textContent = "Building merged PDF…";
  try {
    const rendered = docs.map((d) => ({ id: d.id, html: d.html(AppState.data) }));
    const title = `Packet_${AppState.data.meta.wmtr_last5 || "UDQ"}_${fileStamp()}`;
    const merged = packetMergedHtml(rendered, title);

    const w = window.open("", "_blank");
    if (!w) {
      status.textContent = "Pop-up blocked — allow pop-ups for this page, then click Merged PDF again.";
      status.classList.add("err");
      return;
    }
    w.document.open();
    w.document.write(merged);
    w.document.close();
    w.document.title = title;
    if (typeof auditRecordPrint === "function") {
      const names = docs.map((d) => d.label).join(", ");
      auditRecordPrint("Document Packet — " + names, title + ".pdf", AppState.data.meta.wmtr_last5 || "");
    }
    setTimeout(() => { w.focus(); w.print(); }, 400);
    status.textContent = `Opened ${docs.length} document${docs.length === 1 ? "" : "s"} for printing. Choose “Save as PDF”.`;
  } catch (e) {
    console.error(e);
    status.textContent = `Couldn't build the merged PDF: ${e.message}`;
    status.classList.add("err");
  }
}

async function generatePacketZip() {
  if (typeof atlasGenerateGate === "function" && !atlasGenerateGate("packet", generatePacketZip)) return;
  const status = document.getElementById("pktStatus");
  status.classList.remove("err");
  const docs = _pktSelectedDocs();
  if (!docs.length) return;
  if (!_pktSliGuard(status)) return;
  if (typeof JSZip === "undefined") {
    status.textContent = "JSZip isn't available, so the .zip can't be built.";
    status.classList.add("err");
    return;
  }

  status.textContent = "Building .zip…";
  try {
    const zip = new JSZip();
    const names = [];
    for (const d of docs) {
      const f = await d.file(AppState.data);
      if (f.b64 != null) zip.file(f.name, f.b64, { base64: true });
      else zip.file(f.name, f.text != null ? f.text : "");
      names.push(f.name);
    }
    const b64 = await zip.generateAsync({ type: "base64" });
    const zipName = `Packet_${AppState.data.meta.wmtr_last5 || "UDQ"}_${fileStamp()}.zip`;

    const a = document.createElement("a");
    a.href = "data:application/zip;base64," + b64;
    a.download = zipName;
    document.body.appendChild(a); a.click();
    setTimeout(() => document.body.removeChild(a), 1000);

    status.textContent = `\u2705 Downloaded ${zipName} (${names.length} file${names.length === 1 ? "" : "s"}).`;
  } catch (e) {
    console.error(e);
    status.textContent = `Couldn't build the .zip: ${e.message}`;
    status.classList.add("err");
  }
}

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    packetMergedHtml, _pktScopeCss, _pktSplitRules, _pktSplitDoc, _pktPrefixSelector, PACKET_DOCS,
  };
}
