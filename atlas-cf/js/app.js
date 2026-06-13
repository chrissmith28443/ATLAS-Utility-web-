/* =========================================================================
   ATLAS Utility Web — app.js
   Wires everything together: file loading (SheetJS), UDQ type detection,
   shipment dashboard, and the tool workspaces.
   ========================================================================= */

const AppState = {
  fileName: "",
  grid: null,        // array-of-arrays of strings (1-based access via gridCell)
  udqType: "none",   // none | srf | metrics | property | unknown
  data: null,        // parsed SRF data model (readUdq output)
  activeTool: null,
};

const TOOLS = [
  { id: "ci",       group: "Shipping documents", label: "Commercial Invoice",  needs: "srf",      ready: true  },
  { id: "pl",       group: "Shipping documents", label: "Packing List",        needs: "srf",      ready: true  },
  { id: "placards", group: "Shipping documents", label: "Placards",            needs: "srf",      ready: true  },
  { id: "sli",      group: "Shipping documents", label: "SLI",                 needs: "srf",      ready: true  },
  { id: "rfq",      group: "Shipping documents", label: "RFQ Email",           needs: "srf",      ready: true  },
  { id: "ipc",      group: "Shipping documents", label: "IPC",                 needs: "srf",      ready: true  },
  { id: "po",       group: "Shipping documents", label: "Purchase Order",      needs: "none",     ready: true  },
  { id: "mct",      group: "Shipping documents", label: "MCT Entry Letter",    needs: "none",     ready: true  },
  { id: "metrics",  group: "Metrics",            label: "Metrics",             needs: "metrics",  ready: false },
  { id: "pmr",      group: "Metrics",            label: "PMR",                 needs: "metrics",  ready: true  },
  { id: "reqatt",   group: "Metrics",            label: "Required Attachments",needs: ["metrics","srf"], ready: true  },
  { id: "ecm",      group: "Metrics",            label: "Export-Controlled Materials", needs: "metrics", ready: true },
  { id: "dd1149",   group: "Property management",label: "DD1149",              needs: "property", ready: true  },
  { id: "topdocs",  group: "Property management",label: "TOP Documents",       needs: "property", ready: true  },
  { id: "coreims",  group: "Property management",label: "CoreIMS Export",      needs: "property", ready: true  },
];

/* ---------------- SheetJS adapter ---------------- */

/** Convert the active worksheet of an .xlsx file to a string grid. */
function workbookToGrid(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // header:1 -> array of arrays; raw:false -> formatted strings (matches ATLAS export text)
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null });
  return rows.map((row) => row.map((v) => (v === null || v === undefined ? null : String(v))));
}

/* ---------------- File loading ---------------- */

async function loadFile(file) {
  const status = document.getElementById("loadStatus");
  status.classList.remove("err");
  status.textContent = `Reading ${file.name}…`;
  try {
    const buf = await file.arrayBuffer();
    const grid = workbookToGrid(buf);
    const udqType = detectUdqType(grid);

    AppState.fileName = file.name;
    AppState.grid = grid;
    AppState.udqType = udqType;
    AppState.data = null;
    AppState.activeTool = null;

    if (udqType === "srf") {
      AppState.data = readUdq(grid);
      status.textContent =
        `Loaded ${file.name} — SRF UDQ · ${AppState.data.items.length} line items · ` +
        `${AppState.data.meta.total_pkgs || 0} packages`;
    } else if (udqType === "metrics") {
      let wmtrCount = 0;
      for (let r = 1; r <= Math.min(gridMaxRow(grid), 20000); r++) {
        const v = normWs(gridCell(grid, r, 1)).toUpperCase();
        if (v.startsWith("WMTR-") && v.endsWith("-SRF")) wmtrCount++;
      }
      status.textContent =
        `Loaded ${file.name} — Metrics UDQ · ${wmtrCount} SRF record${wmtrCount === 1 ? "" : "s"} · ` +
        `open PMR from the Metrics group`;
    } else if (udqType === "property") {
      AppState.data = readPropertyUdq(grid);
      status.textContent =
        `Loaded ${file.name} — Property Management UDQ · ${AppState.data.items.length} inventory item` +
        `${AppState.data.items.length === 1 ? "" : "s"}` +
        `${AppState.data.meta.ctr_program ? " · " + AppState.data.meta.ctr_program : ""}`;
    } else {
      status.textContent = `Loaded ${file.name} — but it doesn't look like a known UDQ layout. ` +
        `Check that this is an unmodified ATLAS export.`;
      status.classList.add("err");
    }
  } catch (e) {
    console.error(e);
    AppState.grid = null;
    AppState.udqType = "none";
    AppState.data = null;
    status.textContent = `Couldn't read that file: ${e.message}. ` +
      `Make sure it's an .xlsx export from ATLAS and try again.`;
    status.classList.add("err");
  }
  renderAll();
}

/* ---------------- Rendering: dashboard ---------------- */

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function renderAll() {
  renderRail();
  renderDashboard();
  renderWorkspace();
  renderDropzone();
}

function renderDropzone() {
  const dz = document.getElementById("dropzone");
  const fileTag = document.getElementById("dzFile");
  if (AppState.fileName) {
    dz.classList.add("compact");
    fileTag.textContent = AppState.fileName;
    fileTag.classList.remove("hidden");
    document.getElementById("dzTitle").textContent = "UDQ loaded";
    document.getElementById("dzSub").textContent = "Drop another UDQ here, or click to browse.";
  }
}

function countryShort(s) {
  // "ETHIOPIA - ET" -> "ETHIOPIA", keep as-is otherwise
  const m = String(s || "").match(/^(.*?)\s+-\s+[A-Z]{2}$/);
  return m ? m[1] : (s || "");
}

function renderDashboard() {
  const dash = document.getElementById("dashboard");
  dash.innerHTML = "";
  if (AppState.udqType === "property" && AppState.data) {
    dash.classList.remove("hidden");
    renderPropertyDashboard(dash);
    return;
  }
  if (AppState.udqType !== "srf" || !AppState.data) { dash.classList.add("hidden"); return; }
  dash.classList.remove("hidden");

  const m = AppState.data.meta;
  const p = AppState.data.parties;

  /* Manifest strip */
  const mode = (m.mode_of_transit || "").replace(/\s*Freight\s*/i, " freight").trim();
  dash.appendChild(el(`
    <div class="manifest">
      <div><span class="wmtr">${esc(m.wmtr)}</span><span class="badge">SRF · Shipping</span></div>
      <div></div><div></div>
      <div class="title">${esc(m.request_title)}</div>
      <div class="route">
        <span class="leg">${esc(countryShort(m.country_origin) || p.origin.country || "Origin")}</span>
        <span class="lane"><span class="mode">${esc(mode || "mode TBD")}</span></span>
        <span class="leg">${esc(countryShort(m.country_destination) || p.deliver.country || "Destination")}</span>
      </div>
    </div>`));

  /* Stat cards */
  dash.appendChild(el(`
    <div class="stats">
      <div class="stat"><div class="k">Line items</div><div class="v">${AppState.data.items.length}</div></div>
      <div class="stat"><div class="k">Packages</div><div class="v">${esc(m.total_pkgs || "0")}</div></div>
      <div class="stat"><div class="k">Total weight</div><div class="v mono">${esc(m.total_weight || "—")}</div></div>
      <div class="stat"><div class="k">Total volume</div><div class="v mono">${esc(m.total_volume || "—")}</div></div>
      <div class="stat"><div class="k">Total value (USD)</div><div class="v mono">${esc(m.total_value || "—")}</div></div>
      <div class="stat"><div class="k">Program</div><div class="v">${esc(m.ctr_program || "—")}</div></div>
    </div>`));

  /* Parties */
  const partyDefs = [
    ["Pickup location", p.pickup],
    ["Shipment origin", p.origin],
    ["Delivery destination", p.deliver],
    ["Ultimate consignee", p.consignee],
    ["Intermediate consignee", p.intermediate],
    ["End user", p.end_user],
  ];
  const partyCells = partyDefs.map(([label, party]) => {
    const has = party.addr_lines.some((l) => l) || party.contact;
    if (!has) {
      return `<div class="party empty"><div class="plabel">${esc(label)}</div>Not specified</div>`;
    }
    const poc = [party.contact, party.email, party.phone].filter(Boolean).join(" · ");
    return `<div class="party">
      <div class="plabel">${esc(label)}</div>
      ${party.addr_lines.map(esc).join("<br/>")}${party.country ? "<br/>" + esc(party.country) : ""}
      ${poc ? `<div class="poc">${esc(poc)}</div>` : ""}
    </div>`;
  }).join("");

  dash.appendChild(el(`
    <div class="panel">
      <header><h2>Parties</h2></header>
      <div class="parties">${partyCells}</div>
    </div>`));

  /* Inventory preview */
  const rows = AppState.data.items.map((it) => `
    <tr>
      <td class="num">${esc(it.line)}</td>
      <td class="num">${esc(it.units)}</td>
      <td>${esc(it.uom)}</td>
      <td>${esc(it.desc)}</td>
      <td class="mono">${esc(it.model)}</td>
      <td class="mono">${esc(it.hts)}</td>
      <td class="mono">${esc(it.eccn)}</td>
      <td class="mono">${esc(it.auth)}</td>
      <td>${esc(it.coo)}</td>
      <td class="num">${esc(it.unit_value)}</td>
      <td class="num">${esc(it.total_value)}</td>
    </tr>`).join("");

  const pkgRows = AppState.data.packages.map((pk) => `
    <tr>
      <td>${esc(pk.description || "Package")}</td>
      <td class="num">${pk.count}</td>
      <td class="mono">${esc(pk.dims)}</td>
      <td class="num">${esc(pk.weight_lbs)}</td>
      <td class="num">${pk.volume_ft3 ? pk.volume_ft3.toLocaleString("en-US") : ""}</td>
    </tr>`).join("");

  dash.appendChild(el(`
    <div class="panel">
      <header><h2>Inventory</h2><span class="count">${AppState.data.items.length} items · ${AppState.data.packages.length} package rows</span></header>
      <div class="scrollwrap">
        <table class="data">
          <thead><tr>
            <th>#</th><th>Qty</th><th>UOM</th><th>Description</th><th>Model/Cat</th>
            <th>HTS</th><th>ECCN/USML</th><th>Auth</th><th>COO</th><th>Unit value</th><th>Total</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${AppState.data.packages.length ? `
      <header style="border-top:1px solid var(--line);"><h2>Packages</h2></header>
      <div class="body" style="padding-top:0;">
        <table class="data">
          <thead><tr><th>Type</th><th>Count</th><th>Dims (L×W×H in)</th><th>Weight (lb)</th><th>Volume (ft³)</th></tr></thead>
          <tbody>${pkgRows}</tbody>
        </table>
      </div>` : ""}
    </div>`));
}

/* ---------------- Rendering: tool rail ---------------- */

function renderRail() {
  const rail = document.getElementById("rail");
  rail.innerHTML = "";
  let lastGroup = null;
  for (const tool of TOOLS) {
    if (tool.group !== lastGroup) {
      rail.appendChild(el(`<h3>${esc(tool.group)}</h3>`));
      lastGroup = tool.group;
    }
    // needs "none": always available (UDQ optional — details entered manually).
    // needs "any":  available whenever any UDQ is loaded.
    // otherwise:    available only for the matching UDQ type.
    const typeOk = tool.needs === "none"
      ? true
      : tool.needs === "any"
        ? AppState.udqType !== "none"
        : Array.isArray(tool.needs)
          ? tool.needs.includes(AppState.udqType)
          : AppState.udqType === tool.needs;
    const enabled = tool.ready && typeOk;
    const btn = el(`
      <button class="toolbtn ${AppState.activeTool === tool.id ? "active" : ""} ${enabled ? "ready" : ""}"
              ${enabled ? "" : "disabled"} data-tool="${tool.id}">
        <span class="dot"></span>${esc(tool.label)}
        ${tool.ready ? "" : `<span class="soon">SOON</span>`}
      </button>`);
    if (enabled) {
      btn.addEventListener("click", () => {
        AppState.activeTool = AppState.activeTool === tool.id ? null : tool.id;
        renderRail();
        renderWorkspace();
        if (AppState.activeTool) {
          document.getElementById("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }
    rail.appendChild(btn);
  }
}

/* ---------------- Rendering: tool workspace ---------------- */

function renderWorkspace() {
  const ws = document.getElementById("workspace");
  ws.innerHTML = "";
  if (AppState.activeTool === "ci") renderCiWorkspace(ws);
  else if (AppState.activeTool === "pl") renderPlWorkspace(ws);
  else if (AppState.activeTool === "placards") renderPlacardsWorkspace(ws);
  else if (AppState.activeTool === "sli") renderSliWorkspace(ws);
  else if (AppState.activeTool === "rfq") renderRfqWorkspace(ws);
  else if (AppState.activeTool === "ipc") renderIpcWorkspace(ws);
  else if (AppState.activeTool === "po") renderPoWorkspace(ws);
  else if (AppState.activeTool === "mct") renderMctWorkspace(ws);
  else if (AppState.activeTool === "topdocs") renderTopWorkspace(ws);
  else if (AppState.activeTool === "dd1149") renderDd1149Workspace(ws);
  else if (AppState.activeTool === "coreims") renderCoreimsWorkspace(ws);
  else if (AppState.activeTool === "pmr") renderPmrWorkspace(ws);
  else if (AppState.activeTool === "reqatt") renderReqattWorkspace(ws);
  else if (AppState.activeTool === "ecm") renderEcmWorkspace(ws);
}

/* ---- Commercial Invoice workspace ---- */

function renderCiWorkspace(container) {
  const m = AppState.data.meta;

  const signerOpts = ['<option value="">(leave blank)</option>']
    .concat(SIGNERS.map((s, i) => `<option value="${i}">${esc(s.name)} — ${esc(s.title)}</option>`))
    .join("");
  const purposeOpts = PURPOSE_CHOICES.map((p) => `<option>${esc(p)}</option>`).join("");

  const panel = el(`
    <div class="panel">
      <header><h2>Commercial Invoice</h2><span class="count">${esc(m.wmtr)}</span></header>
      <div class="body">
        <div class="formgrid">
          <div class="field">
            <label for="ciInvDate">Invoice date</label>
            <input type="date" id="ciInvDate" value="${todayISO()}">
          </div>
          <div class="field">
            <label for="ciShipDate">Shipment date</label>
            <input type="date" id="ciShipDate">
            <div class="hint">Optional</div>
          </div>
          <div class="field">
            <label for="ciPurpose">Purpose of shipment</label>
            <select id="ciPurpose">${purposeOpts}</select>
          </div>
          <div class="field">
            <label for="ciPurposeOther">If other</label>
            <input type="text" id="ciPurposeOther" disabled>
          </div>
          <div class="field">
            <label for="ciShipRef">Shipment ref no</label>
            <input type="text" id="ciShipRef">
          </div>
          <div class="field">
            <label for="ciContract">Contract no</label>
            <input type="text" id="ciContract" value="${esc(m.contract_no || DEFAULT_CONTRACT_NO)}">
          </div>
          <div class="field span2">
            <label for="ciComments">Shipment comments</label>
            <textarea id="ciComments" rows="2"></textarea>
          </div>
          <div class="field">
            <label for="ciSigner">Printed name</label>
            <select id="ciSigner">${signerOpts}</select>
          </div>
          <div class="field span2">
            <label for="ciRemarks">Additional remarks</label>
            <textarea id="ciRemarks" rows="2"></textarea>
            <div class="hint">Appears after the standard export-control remarks paragraph.</div>
          </div>
        </div>

        <div class="btnrow">
          <button class="btn primary" id="ciPrint">Save as PDF</button>
          <button class="btn ghost" id="ciRefresh">Refresh preview</button>
          <span class="statusline" id="ciStatus"></span>
        </div>
        <div class="note">
          Save as PDF opens your browser's print window — choose “Save as PDF” as the destination and keep
          Landscape / Letter. The filename is pre-set to <span style="font-family:var(--mono)">CI_${esc(m.wmtr_last5)}_…</span>.
        </div>

        <div class="previewwrap"><iframe id="ciPreview" title="Commercial Invoice preview"></iframe></div>
      </div>
    </div>`);
  container.appendChild(panel);

  const purposeSel = panel.querySelector("#ciPurpose");
  const purposeOther = panel.querySelector("#ciPurposeOther");
  purposeSel.addEventListener("change", () => {
    const isOther = purposeSel.value === "Other";
    purposeOther.disabled = !isOther;
    if (!isOther) purposeOther.value = "";
    updateCiPreview();
  });

  const refresh = () => updateCiPreview();
  for (const id of ["ciInvDate","ciShipDate","ciShipRef","ciContract","ciComments","ciSigner","ciRemarks","ciPurposeOther"]) {
    panel.querySelector("#" + id).addEventListener("change", refresh);
  }
  panel.querySelector("#ciRefresh").addEventListener("click", refresh);
  panel.querySelector("#ciPrint").addEventListener("click", printCi);

  updateCiPreview();
}

function ciOptionsFromForm() {
  const g = (id) => document.getElementById(id);
  let purpose = g("ciPurpose").value;
  if (purpose === "Other") purpose = g("ciPurposeOther").value.trim() || "Other";

  let printedName = "", title = "";
  const signerIdx = g("ciSigner").value;
  if (signerIdx !== "") {
    const s = SIGNERS[Number(signerIdx)];
    printedName = s.name;
    title = s.title;
  }

  return {
    invoiceDate: g("ciInvDate").value || "",
    shipmentDate: g("ciShipDate").value || "",
    purpose,
    shipmentRef: g("ciShipRef").value.trim(),
    contractNo: g("ciContract").value.trim(),
    shipmentComments: g("ciComments").value.replace(/\s+/g, " ").trim(),
    printedName, title,
    userRemarks: g("ciRemarks").value.trim(),
  };
}

function ciDocTitle() {
  return `CI_${AppState.data.meta.wmtr_last5 || "UDQ"}_${fileStamp()}`;
}

function updateCiPreview() {
  const pages = ciBuildPages(AppState.data, ciOptionsFromForm());
  const html = ciRenderHtml(pages, ciDocTitle());
  const iframe = document.getElementById("ciPreview");
  iframe.srcdoc = html;
  document.getElementById("ciStatus").textContent =
    `${pages.length} page${pages.length === 1 ? "" : "s"} · ${AppState.data.items.length} items`;
  // Scale the 10.3in page down to fit the preview pane
  iframe.addEventListener("load", () => {
    try {
      const doc = iframe.contentDocument;
      doc.body.style.zoom = "0.92";
      doc.body.style.background = "transparent";
    } catch (e) { /* ignore */ }
  }, { once: true });
}

function printCi() {
  const pages = ciBuildPages(AppState.data, ciOptionsFromForm());
  const docTitle = ciDocTitle();
  const html = ciRenderHtml(pages, docTitle);

  const w = window.open("", "_blank");
  if (!w) {
    const s = document.getElementById("ciStatus");
    s.textContent = "Pop-up blocked — allow pop-ups for this page, then click Save as PDF again.";
    s.classList.add("err");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.document.title = docTitle;
  // Give the browser a beat to lay out images/fonts, then print
  setTimeout(() => { w.focus(); w.print(); }, 350);
}

/* ---- Shipper's Letter of Instruction workspace (Excel output) ---- */

function renderSliWorkspace(container) {
  const m = AppState.data.meta;

  const locOpts = (sel) => ['<option value="Other (manual)">Other (manual)</option>']
    .concat(Object.keys(SLI_LOCATIONS).map((name) =>
      `<option value="${esc(name)}" ${sel === name ? "selected" : ""}>${esc(name)}</option>`))
    .join("");

  const panel = el(`
    <div class="panel">
      <header><h2>Shipper's Letter of Instruction</h2><span class="count">${esc(m.wmtr)}</span></header>
      <div class="body">
        <div class="formgrid">
          <div class="field">
            <label for="sliFreight">Freight location</label>
            <select id="sliFreight">${locOpts("Sovana Global Logistics")}</select>
            <div class="hint">"Other (manual)" leaves the block blank and highlights it for hand entry.</div>
          </div>
          <div class="field">
            <label for="sliForward">Forwarding agent</label>
            <select id="sliForward">${locOpts("")}</select>
          </div>
          <div class="field">
            <label for="sliDate">Signature date</label>
            <input type="date" id="sliDate" value="${todayISO()}">
            <div class="hint">Written to Box 42 (M31).</div>
          </div>
        </div>

        <div class="btnrow">
          <button class="btn primary" id="sliGen">Generate SLI (.xlsx)</button>
          <button class="btn ghost" id="sliRefresh">Refresh preview</button>
          <span class="statusline" id="sliStatus"></span>
        </div>
        <div class="note">
          The preview below mirrors the generated <span style="font-family:var(--mono)">.xlsx</span> and updates as you
          change the freight location, forwarding agent, or date. Hazmat (DG&nbsp;Yes/No), the $2,500 HTS-group rollup,
          and the embassy intermediate-consignee rule are applied automatically. Yellow cells are blanked/grouped fields
          to review.
        </div>

        <div id="sliSummary" class="statusline"></div>
        <div class="previewwrap"><iframe id="sliPreview" title="SLI preview"></iframe></div>
      </div>
    </div>`);
  container.appendChild(panel);

  const refresh = () => { updateSliSummary(); updateSliPreview(); };
  for (const id of ["sliFreight", "sliForward", "sliDate"]) {
    panel.querySelector("#" + id).addEventListener("change", refresh);
  }
  panel.querySelector("#sliRefresh").addEventListener("click", refresh);
  panel.querySelector("#sliGen").addEventListener("click", generateSli);

  refresh();
}

function sliOptionsFromForm() {
  const g = (id) => document.getElementById(id);
  return {
    freightSel: g("sliFreight").value,
    forwardSel: g("sliForward").value,
    sigDate: g("sliDate").value || "",
  };
}

function updateSliSummary() {
  const model = sliBuildModel(AppState.data, sliOptionsFromForm());
  const s = model.summary;
  const parts = [
    `${s.lineCount} commodity line${s.lineCount === 1 ? "" : "s"}`,
    `DG ${s.hazmatYes ? "Yes" : "No"}`,
    s.embassyIntermediate ? "embassy intermediate consignee" : null,
    s.remaining2500 ? "≤$2,500 box checked" : null,
  ].filter(Boolean);
  document.getElementById("sliSummary").textContent = "Preview · " + parts.join(" · ");
}

function updateSliPreview() {
  const iframe = document.getElementById("sliPreview");
  if (!iframe) return;
  iframe.srcdoc = sliRenderHtml(AppState.data, sliOptionsFromForm());
}

async function generateSli() {
  const status = document.getElementById("sliStatus");
  status.classList.remove("err");
  const opts = sliOptionsFromForm();

  // Match the desktop dialog: both selections required
  if (!opts.freightSel || !opts.forwardSel) {
    status.textContent = "Select both a freight location and a forwarding agent.";
    status.classList.add("err");
    return;
  }

  status.textContent = "Generating…";
  try {
    const model = sliBuildModel(AppState.data, opts);
    const outB64 = await sliWriteWorkbook(model);
    const last5 = AppState.data.meta.wmtr_last5 || "";
    const fname = (last5 ? `SLI_${last5}_${fileStamp()}` : `SLI_${fileStamp()}`) + ".xlsx";

    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + outB64;
    a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => document.body.removeChild(a), 1000);

    status.textContent = `\u2705 Downloaded ${fname}`;
  } catch (e) {
    console.error(e);
    status.textContent = `Couldn't generate the SLI: ${e.message}`;
    status.classList.add("err");
  }
}

/* ---- Inventory Packing Checklist workspace (Excel output) ---- */

function renderIpcWorkspace(container) {
  const m = AppState.data.meta;

  const panel = el(`
    <div class="panel">
      <header><h2>Inventory Packing Checklist</h2><span class="count">${esc(m.wmtr)}</span></header>
      <div class="body">
        <div class="note">
          The IPC lists every inventory item (packages are excluded) with its line number, part number,
          description, quantity, and serial number, and fills the header with the WMTR, origin, ultimate
          consignee, and end user. PO# and the carton/pallet column are left blank for hand entry, matching
          the desktop checklist. The preview mirrors the generated
          <span style="font-family:var(--mono)">.xlsx</span>.
        </div>

        <div class="btnrow">
          <button class="btn primary" id="ipcGen">Generate IPC (.xlsx)</button>
          <button class="btn ghost" id="ipcRefresh">Refresh preview</button>
          <span class="statusline" id="ipcStatus"></span>
        </div>

        <div id="ipcSummary" class="statusline"></div>
        <div class="previewwrap"><iframe id="ipcPreview" title="IPC preview"></iframe></div>
      </div>
    </div>`);
  container.appendChild(panel);

  panel.querySelector("#ipcRefresh").addEventListener("click", updateIpcPreview);
  panel.querySelector("#ipcGen").addEventListener("click", generateIpc);

  updateIpcPreview();
}

function updateIpcPreview() {
  const model = ipcBuildModel(AppState.data);
  const summary = document.getElementById("ipcSummary");
  if (summary) {
    summary.textContent =
      `Preview · ${model.items.length} item${model.items.length === 1 ? "" : "s"}` +
      ` · ${AppState.data.packages.length} package row${AppState.data.packages.length === 1 ? "" : "s"} excluded`;
  }
  const iframe = document.getElementById("ipcPreview");
  if (iframe) iframe.srcdoc = ipcRenderHtml(AppState.data);
}

async function generateIpc() {
  const status = document.getElementById("ipcStatus");
  status.classList.remove("err");
  status.textContent = "Generating…";
  try {
    const model = ipcBuildModel(AppState.data);
    const outB64 = await ipcWriteWorkbook(model);
    const last5 = AppState.data.meta.wmtr_last5 || "";
    const fname = (last5 ? `IPC_${last5}_${fileStamp()}` : `IPC_${fileStamp()}`) + ".xlsx";

    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + outB64;
    a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => document.body.removeChild(a), 1000);

    status.textContent = `\u2705 Downloaded ${fname}`;
  } catch (e) {
    console.error(e);
    status.textContent = `Couldn't generate the IPC: ${e.message}`;
    status.classList.add("err");
  }
}

/* ---- Purchase Order workspace (print-to-PDF document) ---- */

function renderPoWorkspace(container) {
  // The PO works standalone; WMTR is editable and prefilled from a loaded SRF.
  const prefillWmtr = (AppState.data && AppState.data.meta && AppState.data.meta.wmtr) || "";
  const badge = prefillWmtr || "Manual entry";

  const vendorOpts = ['<option value="">(select a vendor)</option>']
    .concat(PO_VENDORS.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`))
    .join("");

  const panel = el(`
    <div class="panel">
      <header><h2>Purchase Order</h2><span class="count">${esc(badge)}</span></header>
      <div class="body">
        <div class="formgrid">
          <div class="field">
            <label for="poDate">PO date</label>
            <input type="date" id="poDate" value="${todayISO()}">
          </div>
          <div class="field">
            <label for="poWmtr">WMTR #</label>
            <input type="text" id="poWmtr" value="${esc(prefillWmtr)}" placeholder="e.g. WMTR-26-1-B-ET-10256-SRF">
            <div class="hint">The last 5 digits form the PO number; at least 5 digits are required.</div>
          </div>
          <div class="field">
            <label for="poVendor">Vendor</label>
            <select id="poVendor">${vendorOpts}</select>
          </div>
          <div class="field">
            <label for="poVendorAddr">Vendor address</label>
            <input type="text" id="poVendorAddr" value="" readonly placeholder="auto-filled from vendor">
            <div class="hint">Filled automatically from the selected vendor.</div>
          </div>
          <div class="field">
            <label for="poCost">Cost amount (USD)</label>
            <input type="text" id="poCost" inputmode="decimal" placeholder="e.g. 4250.00">
            <div class="hint">Digits and an optional decimal point only.</div>
          </div>
          <div class="field span2">
            <label for="poNotes">Notes / comments</label>
            <textarea id="poNotes" rows="3"></textarea>
            <div class="hint">Optional. Appears as a "Comments:" line under the awarded price.</div>
          </div>
        </div>

        <div class="btnrow">
          <button class="btn primary" id="poPrint">Save as PDF</button>
          <button class="btn ghost" id="poRefresh">Refresh preview</button>
          <span class="statusline" id="poStatus"></span>
        </div>
        <div class="note">
          Save as PDF opens your browser's print window — choose &ldquo;Save as PDF&rdquo; as the destination and keep
          Portrait / Letter. The filename is pre-set to
          <span style="font-family:var(--mono)">Purchase_Order_${esc(new Date().getFullYear())}-&hellip;</span>.
          The PO number, &ldquo;USD&rdquo; price formatting, vendor address, and the fixed subject, justification, and
          FAR 47.403 note are all filled in automatically. To attach a vendor quote, print it to the same PDF (or merge
          it afterwards) — this matches the optional quote step from the desktop tool.
        </div>

        <div id="poSummary" class="statusline"></div>
        <div class="previewwrap"><iframe id="poPreview" title="Purchase Order preview"></iframe></div>
      </div>
    </div>`);
  container.appendChild(panel);

  const vendorSel = panel.querySelector("#poVendor");
  const vendorAddr = panel.querySelector("#poVendorAddr");
  vendorSel.addEventListener("change", () => {
    vendorAddr.value = poVendorAddress(vendorSel.value);
    updatePoPreview();
  });

  const refresh = () => updatePoPreview();
  for (const id of ["poDate", "poWmtr", "poCost", "poNotes"]) {
    const node = panel.querySelector("#" + id);
    node.addEventListener("change", refresh);
    node.addEventListener("input", refresh);
  }
  panel.querySelector("#poRefresh").addEventListener("click", refresh);
  panel.querySelector("#poPrint").addEventListener("click", printPo);

  updatePoPreview();
}

function poOptionsFromForm() {
  const g = (id) => document.getElementById(id);
  return {
    poDate: g("poDate") ? g("poDate").value || "" : "",
    wmtr: g("poWmtr") ? g("poWmtr").value || "" : "",
    vendor: g("poVendor") ? g("poVendor").value || "" : "",
    cost: g("poCost") ? g("poCost").value || "" : "",
    notes: g("poNotes") ? g("poNotes").value || "" : "",
  };
}

function poDocTitle(model) {
  return `Purchase_Order_${model.safe_po || "PO"}`;
}

function updatePoPreview() {
  const model = poBuildModel(poOptionsFromForm());
  const summary = document.getElementById("poSummary");
  if (summary) {
    const parts = [
      model.po_number || "PO",
      model.vendor || "no vendor selected",
      model.cost_amount || "no price",
    ];
    summary.textContent = "Preview · " + parts.join(" · ");
  }
  const iframe = document.getElementById("poPreview");
  if (iframe) {
    iframe.srcdoc = poRenderHtml(model, poDocTitle(model));
    iframe.addEventListener("load", () => {
      try {
        const doc = iframe.contentDocument;
        doc.body.style.zoom = "0.9";
      } catch (e) { /* ignore */ }
    }, { once: true });
  }
}

function printPo() {
  const status = document.getElementById("poStatus");
  status.classList.remove("err");
  const opts = poOptionsFromForm();

  // Validation mirrors the desktop PODialog.
  const digits = String(opts.wmtr || "").replace(/\D/g, "");
  if (digits.length < 5) {
    status.textContent = "WMTR must contain at least 5 digits (the last 5 become the PO number).";
    status.classList.add("err");
    return;
  }
  if (!opts.vendor) {
    status.textContent = "Select a vendor.";
    status.classList.add("err");
    return;
  }
  const costVal = parseFloat(String(opts.cost).replace(/[^0-9.]/g, ""));
  if (!String(opts.cost).trim() || !Number.isFinite(costVal) || costVal < 0) {
    status.textContent = "Cost amount must be a valid non-negative number.";
    status.classList.add("err");
    return;
  }

  const model = poBuildModel(opts);
  const docTitle = poDocTitle(model);
  const html = poRenderHtml(model, docTitle);

  const w = window.open("", "_blank");
  if (!w) {
    status.textContent = "Pop-up blocked — allow pop-ups for this page, then click Save as PDF again.";
    status.classList.add("err");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.document.title = docTitle;
  setTimeout(() => { w.focus(); w.print(); }, 350);

  status.textContent = `\u2705 Opened print view for ${model.po_number}.`;
}

/* ---- MCT Entry Letter workspace (editable .docx + print-to-PDF) ----
   Standalone like the PO: no UDQ required, WMTR editable and prefilled from a
   loaded SRF (mirrors the desktop dialog's default_wmtr). Two outputs, both
   built entirely in the browser: a Word .docx from the embedded template
   (desktop parity) and a print-to-PDF of the same letter (web-app parity). */

function renderMctWorkspace(container) {
  const prefillWmtr = (AppState.data && AppState.data.meta && AppState.data.meta.wmtr) || "";
  const badge = prefillWmtr || "Manual entry";

  const portOpts = MCT_PORTS.map((p) => `<option value="${esc(p)}"></option>`).join("");

  const panel = el(`
    <div class="panel">
      <header><h2>MCT Entry Letter</h2><span class="count">${esc(badge)}</span></header>
      <div class="body">
        <div class="formgrid">
          <div class="field">
            <label for="mctLetterDate">Letter date</label>
            <input type="date" id="mctLetterDate" value="${todayISO()}">
            <div class="hint">Prints as &ldquo;Jul 12, 2026&rdquo; at the top of the letter.</div>
          </div>
          <div class="field">
            <label for="mctEntryDate">Date of entry</label>
            <input type="date" id="mctEntryDate" value="${todayISO()}">
            <div class="hint">Prints as &ldquo;12 Aug 2026&rdquo; in the certificate.</div>
          </div>
          <div class="field span2">
            <label for="mctPort">Port of entry</label>
            <input type="text" id="mctPort" list="mctPortList" autocomplete="off"
                   placeholder="start typing an airport or seaport…">
            <datalist id="mctPortList">${portOpts}</datalist>
            <div class="hint">Suggestions are provided, but any text you type is accepted.</div>
          </div>
          <div class="field">
            <label for="mctWmtr">WMTR #</label>
            <input type="text" id="mctWmtr" value="${esc(prefillWmtr)}" placeholder="e.g. WMTR-26-1-B-ET-10256-SRF">
            <div class="hint">The last 5 digits name the file (MCT_Entry_Letter_#####.docx).</div>
          </div>
          <div class="field">
            <label for="mctBolAwb">BoL or AWB</label>
            <input type="text" id="mctBolAwb" placeholder="Bill of Lading / Air Waybill no.">
          </div>
          <div class="field">
            <label for="mctSigner">Signed by</label>
            <select id="mctSigner">${MCT_SIGNERS.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select>
            <div class="hint">Sets the name, phone, and email in the signature block.</div>
          </div>
        </div>

        <div class="btnrow">
          <button class="btn primary" id="mctDocx">Download .docx</button>
          <button class="btn ghost" id="mctRefresh">Refresh preview</button>
          <span class="statusline" id="mctStatus"></span>
        </div>
        <div class="note">
          <b>Download .docx</b> creates the editable Word letter from the DTRA template, exactly like the desktop tool —
          ready to sign or tweak. Port of entry, WMTR #, and BoL/AWB are required; the fixed certificate text, contract
          number, and the selected signer's name, phone, and email are filled in automatically.
        </div>

        <div id="mctSummary" class="statusline"></div>
        <div class="previewwrap"><iframe id="mctPreview" title="MCT Entry Letter preview"></iframe></div>
      </div>
    </div>`);
  container.appendChild(panel);

  const refresh = () => updateMctPreview();
  for (const id of ["mctLetterDate", "mctEntryDate", "mctPort", "mctWmtr", "mctBolAwb", "mctSigner"]) {
    const node = panel.querySelector("#" + id);
    node.addEventListener("change", refresh);
    node.addEventListener("input", refresh);
  }
  panel.querySelector("#mctRefresh").addEventListener("click", refresh);
  panel.querySelector("#mctDocx").addEventListener("click", downloadMctDocx);

  updateMctPreview();
}

function mctOptionsFromForm() {
  const g = (id) => document.getElementById(id);
  return {
    letterDateISO: g("mctLetterDate") ? g("mctLetterDate").value || "" : "",
    entryDateISO: g("mctEntryDate") ? g("mctEntryDate").value || "" : "",
    port: g("mctPort") ? g("mctPort").value || "" : "",
    wmtr: g("mctWmtr") ? g("mctWmtr").value || "" : "",
    bolAwb: g("mctBolAwb") ? g("mctBolAwb").value || "" : "",
    signerId: g("mctSigner") ? g("mctSigner").value || "" : "",
  };
}

function mctDocTitle(model) {
  return model.last5 ? `MCT_Entry_Letter_${model.last5}` : "MCT_Entry_Letter";
}

function updateMctPreview() {
  const model = mctBuildModel(mctOptionsFromForm());
  const summary = document.getElementById("mctSummary");
  if (summary) {
    const parts = [
      model.port_of_entry || "no port",
      model.entry_date || "no entry date",
      model.wmtr || "no WMTR",
    ];
    summary.textContent = "Preview · " + parts.join(" · ");
  }
  const iframe = document.getElementById("mctPreview");
  if (iframe) {
    iframe.srcdoc = mctRenderHtml(model, mctDocTitle(model));
    iframe.addEventListener("load", () => {
      try {
        const doc = iframe.contentDocument;
        doc.body.style.zoom = "0.9";
        doc.body.style.background = "transparent";
      } catch (e) { /* ignore */ }
    }, { once: true });
  }
}

/** Shared validation for both outputs (mirrors the desktop MCTDialog._ok checks). */
function mctValidate(opts, status) {
  if (!opts.port.trim()) {
    status.textContent = "Enter a port of entry.";
    status.classList.add("err");
    return false;
  }
  if (!opts.wmtr.trim()) {
    status.textContent = "Enter a WMTR #.";
    status.classList.add("err");
    return false;
  }
  if (!opts.bolAwb.trim()) {
    status.textContent = "Enter a BoL or AWB.";
    status.classList.add("err");
    return false;
  }
  return true;
}

async function downloadMctDocx() {
  const status = document.getElementById("mctStatus");
  status.classList.remove("err");
  const opts = mctOptionsFromForm();
  if (!mctValidate(opts, status)) return;

  status.textContent = "Generating…";
  try {
    const model = mctBuildModel(opts);
    const blob = await mctBuildDocxBlob(model);
    const fname = mctDocxName(model);

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);

    status.textContent = `\u2705 Downloaded ${fname}`;
  } catch (e) {
    console.error(e);
    status.textContent = `Couldn't build the .docx: ${e.message}`;
    status.classList.add("err");
  }
}

/* ---- Request for Quote workspace (HTML email output) ---- */

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function renderRfqWorkspace(container) {
  const m = AppState.data.meta;

  const panel = el(`
    <div class="panel">
      <header><h2>Request for Quote</h2><span class="count">${esc(m.wmtr)}</span></header>
      <div class="body">
        <div class="formgrid">
          <div class="field">
            <label for="rfqRespDate">Requested response date</label>
            <input type="date" id="rfqRespDate" value="${tomorrowISO()}">
          </div>
          <div class="field">
            <label for="rfqInsured">Insured value (USD)</label>
            <input type="text" id="rfqInsured" inputmode="decimal" placeholder="optional">
            <div class="hint">Leave blank to show “N/A”.</div>
          </div>
          <div class="field">
            <label for="rfqMode">Requested mode of transit</label>
            <select id="rfqMode">
              <option>Air</option><option>Ocean</option><option>Ground</option>
            </select>
          </div>
          <div class="field span3">
            <label for="rfqTo">Recipient(s)</label>
            <input type="text" id="rfqTo" placeholder="optional — e.g. quotes@vendor1.com, sales@vendor2.com">
            <div class="hint">Pre-fills the draft's “To” line. Separate multiple addresses with commas. Leave blank to add them in Outlook.</div>
          </div>

          <div class="field span3">
            <label>Includes EAR / ITAR</label>
            <div class="checkrow">
              <label class="inline"><input type="checkbox" id="rfqEar"> EAR</label>
              <label class="inline"><input type="checkbox" id="rfqItar"> ITAR</label>
              <input type="text" id="rfqEarItarComment" placeholder="optional comment">
            </div>
          </div>

          <div class="field span3">
            <label>Includes dangerous goods</label>
            <div class="checkrow">
              <label class="inline"><input type="radio" name="rfqDg" value="No" checked> No</label>
              <label class="inline"><input type="radio" name="rfqDg" value="Yes"> Yes</label>
              <input type="text" id="rfqDgComment" placeholder="optional comment">
            </div>
          </div>

          <div class="field span3">
            <label>Temperature-control</label>
            <div class="checkrow">
              <label class="inline"><input type="radio" name="rfqTc" value="No" checked> No</label>
              <label class="inline"><input type="radio" name="rfqTc" value="Yes"> Yes</label>
              <input type="text" id="rfqTcComment" placeholder="optional comment">
            </div>
          </div>
        </div>

        <div class="btnrow">
          <button class="btn primary" id="rfqDraft">Open draft email</button>
          <button class="btn ghost" id="rfqCopy">Copy email (HTML)</button>
          <button class="btn ghost" id="rfqRefresh">Refresh preview</button>
          <span class="statusline" id="rfqStatus"></span>
        </div>
        <div class="note">
          <b>Open draft email</b> works just like the desktop tool: it copies the formatted RFQ to your
          clipboard and pops open a new Outlook draft with the subject
          (<span style="font-family:var(--mono)">${esc(rfqSubject(rfqBuildModel(AppState.data, {})))}</span>)
          — and any recipients — already filled in. Click in the message body and press <b>Ctrl+V</b> to drop in
          the table, then send. (Email standards don't let a draft link carry an HTML body, so the body is the one
          paste step.) <b>Copy email (HTML)</b> re-copies the RFQ if you need it again. The package rows,
          centimeter-to-inch conversion, and the EAR/ITAR · DG · temperature lines are filled automatically from the UDQ.
        </div>

        <div id="rfqSummary" class="statusline"></div>
        <div class="previewwrap"><iframe id="rfqPreview" title="RFQ email preview"></iframe></div>
      </div>
    </div>`);
  container.appendChild(panel);

  const refresh = () => { updateRfqSummary(); updateRfqPreview(); updateRfqDraftHref(); };
  for (const id of ["rfqRespDate","rfqInsured","rfqMode","rfqTo","rfqEar","rfqItar",
                    "rfqEarItarComment","rfqDgComment","rfqTcComment"]) {
    const node = panel.querySelector("#" + id);
    if (node) node.addEventListener("change", refresh);
    if (node) node.addEventListener("input", refresh);
  }
  panel.querySelectorAll('input[name="rfqDg"], input[name="rfqTc"]').forEach(
    (n) => n.addEventListener("change", refresh));
  panel.querySelector("#rfqRefresh").addEventListener("click", refresh);
  panel.querySelector("#rfqCopy").addEventListener("click", copyRfqHtml);
  panel.querySelector("#rfqDraft").addEventListener("click", openRfqDraft);

  refresh();
}

function rfqOptionsFromForm(root) {
  const scope = root || document;
  const g = (id) => scope.querySelector("#" + id);
  const radio = (name) => {
    const checked = scope.querySelector(`input[name="${name}"]:checked`);
    return checked ? checked.value : "No";
  };
  return {
    respDate: g("rfqRespDate") ? g("rfqRespDate").value || "" : "",
    insured: g("rfqInsured") ? g("rfqInsured").value || "" : "",
    mode: g("rfqMode") ? g("rfqMode").value || "" : "Air",
    to: g("rfqTo") ? g("rfqTo").value || "" : "",
    ear: g("rfqEar") ? g("rfqEar").checked : false,
    itar: g("rfqItar") ? g("rfqItar").checked : false,
    earitarComment: g("rfqEarItarComment") ? g("rfqEarItarComment").value || "" : "",
    dg: radio("rfqDg"),
    dgComment: g("rfqDgComment") ? g("rfqDgComment").value || "" : "",
    tc: radio("rfqTc"),
    tcComment: g("rfqTcComment") ? g("rfqTcComment").value || "" : "",
  };
}

function updateRfqSummary() {
  const node = document.getElementById("rfqSummary");
  if (!node) return;
  const model = rfqBuildModel(AppState.data, rfqOptionsFromForm());
  const n = model._items.length;
  const parts = [
    `${model.rfq_number || "RFQ"}`,
    `${n} package row${n === 1 ? "" : "s"}`,
    `weight ${model.total_weight_lbs}`,
    `EAR/ITAR ${model.ear_itar.startsWith("Yes") ? "Yes" : "No"}`,
  ];
  node.textContent = "Preview · " + parts.join(" · ");
}

function updateRfqPreview() {
  const iframe = document.getElementById("rfqPreview");
  if (!iframe) return;
  iframe.srcdoc = rfqRenderHtml(AppState.data, rfqOptionsFromForm());
  iframe.addEventListener("load", () => {
    try {
      const doc = iframe.contentDocument;
      doc.body.style.zoom = "0.9";
      doc.body.style.background = "transparent";
    } catch (e) { /* ignore */ }
  }, { once: true });
}

function updateRfqDraftHref() {
  // Subject preview is shown in the note; the .eml is generated on click.
}

async function copyRfqHtml() {
  const status = document.getElementById("rfqStatus");
  status.classList.remove("err");
  const html = rfqRenderHtml(AppState.data, rfqOptionsFromForm());
  const plain = rfqHtmlToPlain(html);
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(plain);
    } else {
      throw new Error("Clipboard API unavailable");
    }
    status.textContent = "\u2705 RFQ copied as HTML — paste into your email body with Ctrl+V.";
  } catch (e) {
    console.error(e);
    status.textContent = `Couldn't copy automatically (${e.message}). ` +
      `Use “Create email draft (.eml)” instead, or select the preview and copy it manually.`;
    status.classList.add("err");
  }
}

function downloadRfqEml() {
  // Retained for callers that explicitly want a body-filled .eml; not wired to
  // the workspace buttons. The primary flow is openRfqDraft() (copy + compose).
  const status = document.getElementById("rfqStatus");
  status.classList.remove("err");
  try {
    const opts = rfqOptionsFromForm();
    const model = rfqBuildModel(AppState.data, opts);
    const subject = rfqSubject(model);
    const html = rfqFillPlaceholders(rfqTemplateHtml(), model);
    const eml = rfqBuildEml(subject, html, { to: opts.to });

    const last5 = AppState.data.meta.wmtr_last5 || "";
    const fname = (last5 ? `RFQ_${last5}_${fileStamp()}` : `RFQ_${fileStamp()}`) + ".eml";

    const blob = new Blob([eml], { type: "message/rfc822" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);

    status.textContent = `\u2705 Saved ${fname} — double-click it to open the draft in Outlook.`;
  } catch (e) {
    console.error(e);
    status.textContent = `Couldn't build the draft: ${e.message}.`;
    status.classList.add("err");
  }
}

/**
 * Desktop-parity action: copy the formatted RFQ to the clipboard, then pop
 * open a new mail draft with the subject (and any recipients) pre-filled.
 * The user clicks in the body and presses Ctrl+V — exactly the desktop flow.
 * Clipboard is written first, while the page still holds focus, because the
 * compose window steals focus and would otherwise block the write.
 */
async function openRfqDraft() {
  const status = document.getElementById("rfqStatus");
  status.classList.remove("err");

  const opts = rfqOptionsFromForm();
  const model = rfqBuildModel(AppState.data, opts);
  const subject = rfqSubject(model);
  const html = rfqFillPlaceholders(rfqTemplateHtml(), model);
  const plain = rfqHtmlToPlain(html);

  // 1) Put the RFQ on the clipboard (rich HTML + plain-text fallback).
  let copied = false;
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      })]);
      copied = true;
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(plain);
      copied = true;
    }
  } catch (e) {
    console.error(e);
    copied = false;
  }

  // 2) Open a new mail draft with the subject (and recipients) pre-filled.
  const recipients = (opts.to || "")
    .split(/[;,]/).map((s) => s.trim()).filter(Boolean).join(",");
  const href = "mailto:" + recipients + "?subject=" + encodeURIComponent(subject);
  const a = document.createElement("a");
  a.href = href;
  document.body.appendChild(a); a.click();
  setTimeout(() => document.body.removeChild(a), 1000);

  status.textContent = copied
    ? "\u2705 Draft opened with the subject filled — click in the body and press Ctrl+V to paste the RFQ."
    : "Draft opened with the subject filled. Couldn't auto-copy — click “Copy email (HTML)”, then paste into the body.";
}

/* ---------------- Property dashboard ---------------- */

function renderPropertyDashboard(dash) {
  const m = AppState.data.meta;
  const p = AppState.data.parties;

  dash.appendChild(el(`
    <div class="manifest">
      <div><span class="wmtr">${esc(m.wmtr)}</span><span class="badge">Property · TOP</span></div>
      <div></div><div></div>
      <div class="title">${esc(m.request_title)}</div>
      <div class="route">
        <span class="leg">${esc(m.partner_country || countryShort(m.country_destination) || "Partner country")}</span>
        <span class="lane"><span class="mode">${esc(m.ctr_program || "program TBD")}</span></span>
        <span class="leg">${esc(m.wmtr_last5 ? "TOP " + m.wmtr_last5 : "TOP #")}</span>
      </div>
    </div>`));

  dash.appendChild(el(`
    <div class="stats">
      <div class="stat"><div class="k">Inventory items</div><div class="v">${AppState.data.items.length}</div></div>
      <div class="stat"><div class="k">Program</div><div class="v">${esc(m.ctr_program || "—")}</div></div>
      <div class="stat"><div class="k">Partner country</div><div class="v">${esc(m.partner_country || "—")}</div></div>
      <div class="stat"><div class="k">Value of cargo</div><div class="v mono">${esc(m.value_of_cargo || "—")}</div></div>
    </div>`));

  const partyDefs = [
    ["Pickup location", p.pickup],
    ["Shipment origin", p.origin],
    ["Delivery destination", p.deliver],
    ["Ultimate consignee", p.consignee],
    ["Intermediate consignee", p.intermediate],
    ["End user", p.end_user],
  ];
  const partyCells = partyDefs.map(([label, party]) => {
    const has = party.addr_lines.some((l) => l) || party.contact;
    if (!has) return `<div class="party empty"><div class="plabel">${esc(label)}</div>Not specified</div>`;
    const poc = [party.contact, party.email, party.phone].filter(Boolean).join(" · ");
    return `<div class="party">
      <div class="plabel">${esc(label)}</div>
      ${party.addr_lines.map(esc).join("<br/>")}${party.country ? "<br/>" + esc(party.country) : ""}
      ${poc ? `<div class="poc">${esc(poc)}</div>` : ""}
    </div>`;
  }).join("");
  dash.appendChild(el(`
    <div class="panel">
      <header><h2>Parties</h2></header>
      <div class="parties">${partyCells}</div>
    </div>`));

  const rows = AppState.data.items.map((it) => `
    <tr>
      <td class="num">${esc(it.item_no)}</td>
      <td>${esc(it.desc)}</td>
      <td>${esc(it.serial)}</td>
      <td>${esc(it.mfr)}</td>
      <td class="mono">${esc(it.model)}</td>
      <td>${esc(it.uom)}</td>
      <td class="num">${esc(it.qty_raw || (it.qty || ""))}</td>
      <td class="num">${esc(it.value_raw || "")}</td>
    </tr>`).join("");
  dash.appendChild(el(`
    <div class="panel">
      <header><h2>Inventory</h2><span class="count">${AppState.data.items.length} items</span></header>
      <div class="scrollwrap">
        <table class="data">
          <thead><tr>
            <th>#</th><th>Description</th><th>Serial #</th><th>Manufacturer</th>
            <th>Model/Cat</th><th>UOM</th><th>Qty</th><th>Value (USD)</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`));
}

/* ---- TOP Documents workspace (cover .docx + inventory .xlsx) ---- */

function renderTopWorkspace(container) {
  const d = topBuildDefaults(AppState.data);
  const m = AppState.data.meta;

  const countryOpts = ['<option value="">— select —</option>']
    .concat(TOP_PARTNER_COUNTRY_OPTIONS.map((c) =>
      `<option value="${esc(c)}" ${d.partner_country === c ? "selected" : ""}>${esc(c)}</option>`))
    .join("");
  const programOpts = ['<option value="">— select —</option>']
    .concat(CTR_PROGRAM_OPTIONS.map((c) =>
      `<option value="${esc(c)}" ${d.ctr_program === c ? "selected" : ""}>${esc(c)}</option>`))
    .join("");

  const panel = el(`
    <div class="panel">
      <header><h2>TOP Documents</h2><span class="count">${esc(m.wmtr)}</span></header>
      <div class="body">
        <div class="formgrid">
          <div class="field">
            <label for="topNumber">TOP number (5 digits)</label>
            <input type="text" id="topNumber" inputmode="numeric" maxlength="5" value="${esc(d.top_number)}"
                   placeholder="10279">
            <div class="hint">Prints as <span style="font-family:var(--mono)">TOP-TTI-#####</span>. Prefilled from the WMTR.</div>
          </div>
          <div class="field">
            <label for="topProgram">CTR program</label>
            <select id="topProgram">${programOpts}</select>
            <div class="hint">Sets the project name below.</div>
          </div>
          <div class="field span2">
            <label for="topProject">CTR project name</label>
            <input type="text" id="topProject" value="${esc(d.ctr_project_name)}">
          </div>
          <div class="field">
            <label for="topCountry">Partner country</label>
            <select id="topCountry">${countryOpts}</select>
          </div>
          <div class="field">
            <label for="topMinistry">Ministry / agency</label>
            <input type="text" id="topMinistry" value="${esc(d.ministry_agency)}" placeholder="Ministry / agency">
          </div>
          <div class="field span2">
            <label for="topInstitute">Institute</label>
            <input type="text" id="topInstitute" value="${esc(d.institute_name)}">
          </div>
          <div class="field span2">
            <label for="topSite">Site / location</label>
            <textarea id="topSite" rows="4">${esc(d.site_location)}</textarea>
            <div class="hint">Address block (no organization line); appears on the cover letter.</div>
          </div>
          <div class="field span2">
            <label for="topFacility">Partner facility</label>
            <input type="text" id="topFacility" value="${esc(d.partner_facility)}">
            <div class="hint">Inventory sheet only.</div>
          </div>
          <div class="field">
            <label for="topRep">Partner representative</label>
            <input type="text" id="topRep" value="${esc(d.partner_representative)}">
          </div>
          <div class="field">
            <label for="topProcuring">CTR procuring entity</label>
            <input type="text" id="topProcuring" value="${esc(d.ctr_procuring_entity)}">
          </div>
          <div class="field">
            <label for="topTransfer">Transfer date</label>
            <input type="date" id="topTransfer" value="${esc(d.transfer_date)}">
          </div>
          <div class="field">
            <label for="topInvDate">Inventory date</label>
            <input type="date" id="topInvDate" value="${esc(d.inventory_date)}">
          </div>
          <div class="field span2">
            <label for="topContractor">Contractor</label>
            <input type="text" id="topContractor" value="${esc(d.contractor_name)}">
          </div>
          <div class="field span2">
            <label for="topContractorPoc">Contractor POC</label>
            <input type="text" id="topContractorPoc" value="${esc(d.contractor_poc)}">
          </div>
          <div class="field">
            <label for="topContractorPhone">Contractor POC phone</label>
            <input type="text" id="topContractorPhone" value="${esc(d.contractor_poc_phone)}">
          </div>
          <div class="field">
            <label for="topContractorEmail">Contractor POC email</label>
            <input type="text" id="topContractorEmail" value="${esc(d.contractor_poc_email)}">
          </div>
        </div>

        <div class="btnrow">
          <button class="btn primary" id="topGenCover">Generate TOP (.docx)</button>
          <button class="btn primary" id="topGenInv">Generate Inventory Sheet (.xlsx)</button>
          <button class="btn ghost" id="topRefresh">Refresh preview</button>
          <span class="statusline" id="topStatus"></span>
        </div>
        <div class="note">
          <b>Generate TOP</b> builds the editable Word cover letter (Report of Transfer); <b>Generate Inventory
          Sheet</b> builds the Excel inventory from the ${AppState.data.items.length} UDQ item${AppState.data.items.length === 1 ? "" : "s"}.
          The cover requires the TOP number, program, project, partner country, ministry, institute, site/location,
          transfer date, procuring entity, and representative. The inventory additionally uses the partner facility,
          inventory date, and contractor details.
        </div>

        <div class="btnrow" id="topTabs" style="gap:6px;">
          <button class="btn ghost active" id="topTabCover" data-tab="cover">Cover preview</button>
          <button class="btn ghost" id="topTabInv" data-tab="inv">Inventory preview</button>
        </div>
        <div class="previewwrap"><iframe id="topPreview" title="TOP preview"></iframe></div>
      </div>
    </div>`);
  container.appendChild(panel);

  let activeTab = "cover";

  const syncProject = () => {
    const prog = panel.querySelector("#topProgram").value;
    const mapped = CTR_PROGRAM_TO_PROJECT_NAME[prog];
    if (mapped !== undefined) panel.querySelector("#topProject").value = mapped;
  };
  const refresh = () => updateTopPreview(activeTab);

  panel.querySelector("#topProgram").addEventListener("change", () => { syncProject(); refresh(); });
  for (const id of ["topNumber", "topProject", "topCountry", "topMinistry", "topInstitute",
    "topSite", "topFacility", "topRep", "topProcuring", "topTransfer", "topInvDate",
    "topContractor", "topContractorPoc", "topContractorPhone", "topContractorEmail"]) {
    const node = panel.querySelector("#" + id);
    node.addEventListener("input", refresh);
    node.addEventListener("change", refresh);
  }
  const setTab = (tab) => {
    activeTab = tab;
    panel.querySelector("#topTabCover").classList.toggle("active", tab === "cover");
    panel.querySelector("#topTabInv").classList.toggle("active", tab === "inv");
    refresh();
  };
  panel.querySelector("#topTabCover").addEventListener("click", () => setTab("cover"));
  panel.querySelector("#topTabInv").addEventListener("click", () => setTab("inv"));
  panel.querySelector("#topRefresh").addEventListener("click", refresh);
  panel.querySelector("#topGenCover").addEventListener("click", () => generateTop("cover"));
  panel.querySelector("#topGenInv").addEventListener("click", () => generateTop("inventory"));

  refresh();
}

function topOptionsFromForm() {
  const g = (id) => document.getElementById(id);
  const v = (id) => (g(id) ? g(id).value || "" : "");
  return {
    top_number: v("topNumber").trim(),
    ctr_program: v("topProgram"),
    ctr_project_name: v("topProject"),
    partner_country: v("topCountry"),
    ministry_agency: v("topMinistry"),
    institute_name: v("topInstitute"),
    site_location: v("topSite"),
    partner_facility: v("topFacility"),
    partner_representative: v("topRep"),
    ctr_procuring_entity: v("topProcuring"),
    transfer_date: v("topTransfer"),
    inventory_date: v("topInvDate"),
    contractor_name: v("topContractor"),
    contractor_poc: v("topContractorPoc"),
    contractor_poc_phone: v("topContractorPhone"),
    contractor_poc_email: v("topContractorEmail"),
    wmtr_number: AppState.data.meta.wmtr,
    wmtr_last5: AppState.data.meta.wmtr_last5,
  };
}

function topModelFromForm() {
  const opts = topOptionsFromForm();
  const model = topBuildModel(opts);
  model.items = AppState.data.items;
  return model;
}

function updateTopPreview(tab) {
  const iframe = document.getElementById("topPreview");
  if (!iframe) return;
  const model = topModelFromForm();
  iframe.srcdoc = (tab === "inv")
    ? topInventoryRenderHtml(model)
    : topCoverRenderHtml(model);
}

/** Mirror of the desktop TOPDialog validation. mode = "cover" | "inventory". */
function topValidate(opts, mode, status) {
  const fail = (msg) => { status.textContent = msg; status.classList.add("err"); return false; };
  const dateOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

  if (!opts.top_number) return fail("Enter a TOP number.");
  if (!/^\d{5}$/.test(opts.top_number)) return fail("The TOP number must be exactly 5 digits.");

  const needCover = {
    institute_name: "an institute",
    ministry_agency: "a ministry / agency",
    partner_country: "a partner country",
    site_location: "a site / location",
    ctr_procuring_entity: "a CTR procuring entity",
    partner_representative: "a partner representative",
  };
  for (const [k, label] of Object.entries(needCover)) {
    if (!String(opts[k] || "").trim()) return fail(`Enter ${label}.`);
  }
  if (!opts.transfer_date) return fail("Enter a transfer date.");
  if (!dateOk(opts.transfer_date)) return fail("Transfer date must be YYYY-MM-DD.");

  if (mode === "inventory") {
    const needInv = {
      partner_facility: "a partner facility",
      ctr_program: "a CTR program",
      contractor_name: "a contractor",
      contractor_poc: "a contractor POC",
    };
    for (const [k, label] of Object.entries(needInv)) {
      if (!String(opts[k] || "").trim()) return fail(`Enter ${label}.`);
    }
    if (!opts.inventory_date) return fail("Enter an inventory date.");
    if (!dateOk(opts.inventory_date)) return fail("Inventory date must be YYYY-MM-DD.");
  }
  return true;
}

async function generateTop(mode) {
  const status = document.getElementById("topStatus");
  status.classList.remove("err");
  const opts = topOptionsFromForm();
  if (!topValidate(opts, mode, status)) return;

  status.textContent = "Generating…";
  try {
    const model = topBuildModel(opts);
    model.items = AppState.data.items;

    if (mode === "cover") {
      const blob = await topCoverBuildDocxBlob(model);
      const fname = topCoverName(model);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
      status.textContent = `\u2705 Downloaded ${fname}`;
    } else {
      const outB64 = await topInventoryWriteWorkbook(model);
      const fname = topInventoryName(model);
      const a = document.createElement("a");
      a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + outB64;
      a.download = fname;
      document.body.appendChild(a); a.click();
      setTimeout(() => document.body.removeChild(a), 1000);
      status.textContent = `\u2705 Downloaded ${fname}`;
    }
  } catch (e) {
    console.error(e);
    status.textContent = `Couldn't generate the ${mode === "cover" ? "cover letter" : "inventory sheet"}: ${e.message}`;
    status.classList.add("err");
  }
}

/* ---- DD1149 workspace (single .xlsx; Requisition & Shipping Document) ---- */

function renderDd1149Workspace(container) {
  const d = dd1149BuildDefaults(AppState.data);
  const m = AppState.data.meta;
  const n = AppState.data.items.length;

  const opt = (val, cur) => `<option value="${esc(val)}" ${cur === val ? "selected" : ""}>${esc(val)}</option>`;
  const priorityOpts = ["Routine", "Urgent", "High"].map((v) => opt(v, d.priority)).join("");
  const modeOpts = ["Air", "Ground", "Surface"].map((v) => opt(v, d.mode_of_shipment)).join("");

  const panel = el(`
    <div class="panel">
      <header><h2>DD1149</h2><span class="count">${esc(m.wmtr)}</span></header>
      <div class="body">
        <div class="formgrid">
          <div class="field">
            <label for="ddReqDate">Requisition date</label>
            <input type="date" id="ddReqDate" value="${esc(d.requisition_date)}">
            <div class="hint">Required. Written to the form as <span style="font-family:var(--mono)">YYYYMMDD</span>.</div>
          </div>
          <div class="field">
            <label for="ddRequiredDate">Date material required</label>
            <input type="date" id="ddRequiredDate" value="${esc(d.required_date)}">
            <div class="hint">Optional.</div>
          </div>
          <div class="field">
            <label for="ddPriority">Priority</label>
            <select id="ddPriority">${priorityOpts}</select>
          </div>
          <div class="field">
            <label for="ddMode">Mode of shipment</label>
            <select id="ddMode">${modeOpts}</select>
          </div>
          <div class="field">
            <label for="ddSigName">Name of signatory</label>
            <input type="text" id="ddSigName" value="${esc(d.signatory_name)}" placeholder="Required">
          </div>
          <div class="field">
            <label for="ddSigTitle">Title of signatory</label>
            <input type="text" id="ddSigTitle" value="${esc(d.signatory_title)}" placeholder="Required">
          </div>
          <div class="field">
            <label for="ddSigned">Date signed</label>
            <input type="date" id="ddSigned" value="${esc(d.date_signed)}">
            <div class="hint">Optional.</div>
          </div>
          <div class="field"></div>
          <div class="field span2">
            <label for="ddUltimate">Ultimate consignee</label>
            <textarea id="ddUltimate" rows="5">${esc(d.ultimate_block)}</textarea>
            <div class="hint">Prefilled from the UDQ (org, address, city/state/zip, country, POC). Box 9 on the form.</div>
          </div>
          <div class="field span2">
            <label for="ddDelivery">Delivery destination</label>
            <textarea id="ddDelivery" rows="5">${esc(d.delivery_block)}</textarea>
            <div class="hint">Prefilled from the UDQ. Box 13 on the form.</div>
          </div>
        </div>

        <div class="btnrow">
          <button class="btn primary" id="ddGen">Create DD1149 (.xlsx)</button>
          <button class="btn ghost" id="ddRefresh">Refresh preview</button>
          <span class="statusline" id="ddStatus"></span>
        </div>
        <div class="note">
          Builds the DD Form 1149 from the ${n} UDQ inventory item${n === 1 ? "" : "s"}. The first page holds 5
          items; any beyond that flow onto continuation sheets (10 per page) that are added automatically. The WMTR,
          consignee, and delivery blocks come from the loaded UDQ. Requisition date, name of signatory, and title of
          signatory are required.
        </div>

        <div class="previewwrap"><iframe id="ddPreview" title="DD1149 preview"></iframe></div>
      </div>
    </div>`);
  container.appendChild(panel);

  const refresh = () => updateDd1149Preview();
  for (const id of ["ddReqDate", "ddRequiredDate", "ddPriority", "ddMode", "ddSigName",
    "ddSigTitle", "ddSigned", "ddUltimate", "ddDelivery"]) {
    const node = panel.querySelector("#" + id);
    node.addEventListener("input", refresh);
    node.addEventListener("change", refresh);
  }
  panel.querySelector("#ddRefresh").addEventListener("click", refresh);
  panel.querySelector("#ddGen").addEventListener("click", generateDd1149);

  refresh();
}

function dd1149OptionsFromForm() {
  const v = (id) => { const g = document.getElementById(id); return g ? (g.value || "") : ""; };
  return {
    wmtr: AppState.data.meta.wmtr || "",
    requisition_date: v("ddReqDate"),
    required_date: v("ddRequiredDate"),
    priority: v("ddPriority") || "Routine",
    mode_of_shipment: v("ddMode") || "Air",
    signatory_name: v("ddSigName").trim(),
    signatory_title: v("ddSigTitle").trim(),
    date_signed: v("ddSigned"),
    ultimate_block: v("ddUltimate"),
    delivery_block: v("ddDelivery"),
  };
}

function updateDd1149Preview() {
  const iframe = document.getElementById("ddPreview");
  if (!iframe) return;
  const model = dd1149BuildModel(dd1149OptionsFromForm(), AppState.data);
  iframe.srcdoc = dd1149RenderHtml(model);
}

/** Mirror of the desktop TOPDialog validation. */
function dd1149Validate(opts, status) {
  const fail = (msg) => { status.textContent = msg; status.classList.add("err"); return false; };
  const dateOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

  if (!opts.requisition_date) return fail("Requisition date is required.");
  if (!dateOk(opts.requisition_date)) return fail("Requisition date must be YYYY-MM-DD.");
  if (opts.required_date && !dateOk(opts.required_date)) return fail("Date material required must be YYYY-MM-DD.");
  if (opts.date_signed && !dateOk(opts.date_signed)) return fail("Date signed must be YYYY-MM-DD.");
  if (!opts.signatory_name) return fail("Name of signatory is required.");
  if (!opts.signatory_title) return fail("Title of signatory is required.");
  return true;
}

async function generateDd1149() {
  const status = document.getElementById("ddStatus");
  status.classList.remove("err");
  const opts = dd1149OptionsFromForm();
  if (!dd1149Validate(opts, status)) return;

  status.textContent = "Generating…";
  try {
    const model = dd1149BuildModel(opts, AppState.data);
    const outB64 = await dd1149WriteWorkbook(model);
    const fname = dd1149Name(model);
    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + outB64;
    a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => document.body.removeChild(a), 1000);
    status.textContent = `\u2705 Downloaded ${fname}`;
  } catch (e) {
    console.error(e);
    status.textContent = `Couldn't generate the DD1149: ${e.message}`;
    status.classList.add("err");
  }
}

/* ---- CoreIMS Export workspace (Excel import workbook) ---- */

function renderCoreimsWorkspace(container) {
  const m = AppState.data.meta;
  const badge = m.wmtr || "Property UDQ";

  const panel = el(`
    <div class="panel">
      <header><h2>CoreIMS Export</h2><span class="count">${esc(badge)}</span></header>
      <div class="body">
        <div class="note">
          Builds the CoreIMS import workbook (sheet <span style="font-family:var(--mono)">in</span>) from the
          Property Management UDQ's Inventory List. Each item's description, serial, model, vendor, manufacturer,
          unit of issue, country of origin, temperature control, shelf life, HAZMAT, material handling, and general
          comments are mapped into the matching CoreIMS columns; all other columns are left blank. Package rows are
          kept but their serial number is cleared, matching the desktop. The preview mirrors the generated
          <span style="font-family:var(--mono)">.xlsx</span>.
        </div>

        <div class="btnrow">
          <button class="btn primary" id="cimsGen">Generate CoreIMS import (.xlsx)</button>
          <button class="btn ghost" id="cimsRefresh">Refresh preview</button>
          <span class="statusline" id="cimsStatus"></span>
        </div>

        <div id="cimsSummary" class="statusline"></div>
        <div class="previewwrap"><iframe id="cimsPreview" title="CoreIMS preview"></iframe></div>
      </div>
    </div>`);
  container.appendChild(panel);

  panel.querySelector("#cimsRefresh").addEventListener("click", updateCoreimsPreview);
  panel.querySelector("#cimsGen").addEventListener("click", generateCoreims);

  updateCoreimsPreview();
}

function updateCoreimsPreview() {
  const model = coreimsBuildModel(AppState.grid);
  const summary = document.getElementById("cimsSummary");
  if (summary) {
    if (model.missing && model.missing.length) {
      summary.textContent =
        `Cannot generate — UDQ is missing ${model.missing.length} required ` +
        `inventory column${model.missing.length === 1 ? "" : "s"}.`;
      summary.classList.add("err");
    } else {
      summary.classList.remove("err");
      summary.textContent =
        `Preview · ${model.items.length} item${model.items.length === 1 ? "" : "s"} ` +
        `→ sheet "in"`;
    }
  }
  const gen = document.getElementById("cimsGen");
  if (gen) gen.disabled = !!(model.missing && model.missing.length);

  const iframe = document.getElementById("cimsPreview");
  if (iframe) iframe.srcdoc = coreimsRenderHtml(model);
}

async function generateCoreims() {
  const status = document.getElementById("cimsStatus");
  status.classList.remove("err");
  status.textContent = "Generating…";
  try {
    const model = coreimsBuildModel(AppState.grid);
    const outB64 = await coreimsWriteWorkbook(model);
    const last5 = model.wmtr_last5 || "";
    const fname = (last5 ? `CoreIMS_Import_${last5}_${fileStamp()}` : `CoreIMS_Import_${fileStamp()}`) + ".xlsx";

    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + outB64;
    a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => document.body.removeChild(a), 1000);

    status.textContent = `\u2705 Downloaded ${fname}`;
  } catch (e) {
    console.error(e);
    status.textContent = `Couldn't generate the CoreIMS import: ${e.message}`;
    status.classList.add("err");
  }
}

/* ---------------- Boot ---------------- */

function initDropzone() {
  const dz = document.getElementById("dropzone");
  const input = document.getElementById("fileInput");

  dz.addEventListener("click", () => input.click());
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  input.addEventListener("change", () => {
    if (input.files && input.files[0]) loadFile(input.files[0]);
    input.value = "";
  });

  for (const evt of ["dragover", "dragenter"]) {
    dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.add("dragover"); });
  }
  for (const evt of ["dragleave", "drop"]) {
    dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.remove("dragover"); });
  }
  dz.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initDropzone();
  renderRail();
});
