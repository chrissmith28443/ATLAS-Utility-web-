/* =========================================================================
   ATLAS Utility Web — packet.js
   "Generate packet" batch action (Feature #2).

   One click: pick which shipping documents to include, choose a signer, then
   produce either:
     (a) SEPARATE PDFs — each selected document printed in turn in one print
         window, titled with its own file name (CI_…, PL_…, Placards_…), so each
         "Save as PDF" makes its own file (the same crisp, vector print-to-PDF
         path the individual tools use), or
     (b) a .ZIP of individual files — real .xlsx for the Excel docs, print-ready
         .html for the PDF docs (open → Save as PDF).

   Each document is generated from sensible defaults (today's date, auto CI mode,
   pickup → delivery, etc.). The only per-packet choice is the signer, applied to
   the Commercial Invoice and Packing List. Other defaults — which documents are
   pre-selected, unit system, contract number, CI purpose — come from Settings
   (the gear icon) and persist per browser.

   WHY THIS SHAPE (flagged design decisions):
     * No PDF library is introduced. Every PDF in this app is produced by the
       browser's print-to-PDF (vector, sharp text — important for customs docs),
       so separate PDFs mean one print dialog per document, and the zip can't
       contain real PDF bytes for the print docs, so they ship as .html.
     * Eligible docs: CI, PL, Placards, IPC — the SRF shipping documents that
       render fully from the UDQ + defaults. PO and MCT (manual / validated
       input) and RFQ (email draft) aren't in the one-click packet.

   Each *RenderHtml() returns a COMPLETE HTML document with its own <style> and
   @page size (CI landscape, PL/Placards portrait), so each prints as-is.
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
    id: "ci", label: "Commercial Invoice", kind: "pdf", prefix: "CI",
    html(data) { return ciRenderHtml(ciBuildPages(data, _pktCiOpts(data)), _pktName("CI", data)); },
    async file(data) { return { name: _pktName("CI", data) + ".html", mime: "text/html", text: this.html(data) }; },
  },
  {
    id: "pl", label: "Packing List", kind: "pdf", prefix: "PL",
    html(data) { return plRenderHtml(data, _pktPlOpts(data)); },
    async file(data) { return { name: _pktName("PL", data) + ".html", mime: "text/html", text: this.html(data) }; },
  },
  {
    id: "placards", label: "Placards", kind: "pdf", prefix: "Placards",
    html(data) { return placardsRenderHtml(placardsBuildModel(data, _pktPlacardsOpts(data)), _pktName("Placards", data)); },
    async file(data) { return { name: _pktName("Placards", data) + ".html", mime: "text/html", text: this.html(data) }; },
  },
  {
    id: "ipc", label: "Inventory Packing Checklist", kind: "xlsx", prefix: "IPC",
    html(data) { return ipcRenderHtml(data); },
    async file(data) {
      const b64 = await ipcWriteWorkbook(ipcBuildModel(data));
      return { name: _pktName("IPC", data) + ".xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", b64 };
    },
  },
  {
    id: "sli", label: "Shipper's Letter of Instruction", kind: "xlsx", prefix: "SLI",
    html(data) { return sliRenderHtml(data, _pktSliOpts(data)); },
    async file(data) {
      const b64 = await sliWriteWorkbook(sliBuildModel(data, _pktSliOpts(data)));
      return { name: _pktName("SLI", data) + ".xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", b64 };
    },
  },
];

function _pktDocById(id) { return PACKET_DOCS.find((d) => d.id === id); }

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
  // Settings "Default signer", else whoever was picked last (settings.js).
  const defaultSigner = (typeof atlasStartSignerName === "function") ? atlasStartSignerName()
    : ((typeof AtlasSettings !== "undefined") ? AtlasSettings.get().packetSigner : "");
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
      <span class="pkt-kind">${d.kind === "pdf" ? "PDF" : "Excel"}</span>
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
          Pick the documents and a signer, then build them all at once. <strong>Save PDFs</strong> saves each selected
          document as its own PDF: they print one after another in one window, each already named
          (CI_…, PL_…, Placards_…) — choose “Save as PDF” in each print dialog. <strong>Download .zip</strong> packages
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
          <button class="btn primary" id="pktPdf">Save PDFs</button>
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
  panel.querySelector("#pktSigner").addEventListener("change", (e) => {
    if (typeof atlasRememberSigner === "function") atlasRememberSigner(e.target.value);
  });
  const settingsLink = panel.querySelector("#pktOpenSettings");
  if (settingsLink) settingsLink.addEventListener("click", (e) => { e.preventDefault(); if (typeof openSettings === "function") openSettings(); });
  panel.querySelector("#pktPdf").addEventListener("click", generatePacketPdfs);
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

/** Resolves once the print window's freshly written document has laid out
 *  (load + web fonts), plus a beat for images — as the single-document tools do. */
function _pktWaitLayout(w) {
  return new Promise((resolve) => {
    const go = () => setTimeout(resolve, 350);
    const afterFonts = () => {
      const fonts = w.document.fonts && w.document.fonts.ready;
      if (fonts) fonts.then(go, go); else go();
    };
    if (w.document.readyState === "complete") afterFonts();
    else w.addEventListener("load", afterFonts, { once: true });
  });
}

/** Print and resolve when the dialog is done. Chromium's print() blocks until the
 *  dialog closes; other browsers return at once and fire "afterprint" later. */
function _pktPrintAndWait(w) {
  return new Promise((resolve) => {
    w.addEventListener("afterprint", () => resolve(), { once: true });
    w.focus();
    const t0 = Date.now();
    w.print();
    if (Date.now() - t0 > 250) resolve();
  });
}

/** Separate PDFs: print each selected document in turn in ONE window (a second
 *  window.open per click would be pop-up blocked), retitling it before each
 *  print so "Save as PDF" suggests that document's own file name. */
async function generatePacketPdfs() {
  if (typeof atlasGenerateGate === "function" && !atlasGenerateGate("packet", generatePacketPdfs)) return;
  const status = document.getElementById("pktStatus");
  status.classList.remove("err");
  const docs = _pktSelectedDocs();
  if (!docs.length) return;
  if (!_pktSliGuard(status)) return;

  const w = window.open("", "_blank");
  if (!w) {
    status.textContent = "Pop-up blocked — allow pop-ups for this page, then click Save PDFs again.";
    status.classList.add("err");
    return;
  }
  const last5 = AppState.data.meta.wmtr_last5 || "";
  try {
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      if (w.closed) {
        status.textContent = `Stopped — the print window was closed after ${i} of ${docs.length} document${docs.length === 1 ? "" : "s"}.`;
        return;
      }
      const title = _pktName(d.prefix, AppState.data);
      status.textContent = `Document ${i + 1} of ${docs.length}: ${d.label} — choose “Save as PDF” in the print window.`;
      w.document.open();
      w.document.write(d.html(AppState.data));
      w.document.close();
      w.document.title = title;
      await _pktWaitLayout(w);
      if (typeof auditRecordPrint === "function") auditRecordPrint(d.label + " (packet)", title + ".pdf", last5);
      await _pktPrintAndWait(w);
    }
    if (!w.closed) w.close();
    status.textContent = `\u2705 Printed ${docs.length} document${docs.length === 1 ? "" : "s"} as separate PDFs.`;
  } catch (e) {
    console.error(e);
    status.textContent = `Couldn't print the packet: ${e.message}`;
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
    PACKET_DOCS,
  };
}
