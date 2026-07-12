/* =========================================================================
   ATLAS Utility Web — tools/pl.js  (v1.3)

   Manipulates the .xlsx zip at the XML level using JSZip.
   All styles/merges/fonts stay intact.

   Row insertion strategy (avoids duplicate-row corruption):
     1. All edits at original template row numbers first.
     2. Inserted rows get TEMPORARY high row numbers (9000, 9001, …)
        so they never collide with existing rows.
     3. After all insertions, a single sequential renumber pass walks
        the XML in document order and assigns r=1,2,3,… to every <row>,
        also updating the cell addresses inside each row.
     4. Merge ranges and <dimension> are updated based on final row count.
   ========================================================================= */

/* ── UI ──────────────────────────────────────────────────────────────────── */

function renderPlWorkspace(container) {
  const m = AppState.data.meta;
  // Pre-select the Settings "Default signer" so a new Packing List starts with
  // the configured signer (previously it always started blank). SIGNERS already
  // includes any custom signers (rebuilt at startup), so this matches by name.
  const defSigner = (typeof AtlasSettings !== "undefined") ? (AtlasSettings.get().packetSigner || "") : "";
  const defIdx = defSigner ? SIGNERS.findIndex((s) => s.name === defSigner) : -1;
  const signerOpts = ['<option value="">(leave blank)</option>']
    .concat(SIGNERS.map((s, i) =>
      `<option value="${i}"${i === defIdx ? " selected" : ""}>${esc(s.name)} — ${esc(s.title)}</option>`))
    .join("");

  // Only offer party choices that actually carry data in this UDQ; always keep
  // the default so the control is never empty.
  const P = AppState.data.parties || {};
  const hasParty = (p) => !!(p && ((p.addr_lines || []).some(Boolean) || p.contact || p.country));
  const fromOpts = [
    { k: "pickup", label: "Pickup Location" },
    { k: "origin", label: "Shipment Origin" },
  ];
  const toOpts = [
    { k: "deliver", label: "Delivery Destination" },
    { k: "consignee", label: "Ultimate Consignee" },
    { k: "intermediate", label: "Intermediate Consignee" },
  ];
  const optHtml = (arr, dflt) => arr.map((o, i) => {
    const empty = !hasParty(P[o.k]);
    return `<option value="${o.k}" ${o.k === dflt ? "selected" : ""}>` +
      `${esc(o.label)}${empty ? " (blank in UDQ)" : ""}</option>`;
  }).join("");

  const panel = el(`
    <div class="panel">
      <header>
        <h2>Packing List</h2>
        <span class="count">${esc(m.wmtr)}</span>
      </header>
      <div class="body">
        <div class="formgrid">
          <div class="field">
            <label for="plFrom">Ship From</label>
            <select id="plFrom">${optHtml(fromOpts, "pickup")}</select>
          </div>
          <div class="field">
            <label for="plTo">Ship To</label>
            <select id="plTo">${optHtml(toOpts, "deliver")}</select>
          </div>
          <div class="field">
            <label for="plUnit">Unit system</label>
            <select id="plUnit">
              <option value="imperial" selected>Imperial (lbs / in)</option>
              <option value="metric">Metric (kg / cm)</option>
            </select>
          </div>
          <div class="field">
            <label for="plSigner">Printed name / signer</label>
            <select id="plSigner" data-fc-skip>${signerOpts}</select>
          </div>
        </div>
        <div class="btnrow">
          <button class="btn primary" id="plPrint">Save as PDF</button>
          <button class="btn primary" id="plExcel">Download Excel (.xlsx)</button>
          <button class="btn ghost" id="plGenerate">Legacy spreadsheet (.xlsx)</button>
          <button class="btn ghost" id="plRefresh">Refresh preview</button>
          <span class="statusline" id="plStatus"></span>
        </div>
        <div class="note">
          The preview below is the new Packing List: parent packages (Serial
          “P”) become cards, and inventory items are nested under the parent
          whose <strong>Ship Group #</strong> they match. Items with no matching
          group are listed under “Loose / unassigned.”
          Loaded from this UDQ: ${AppState.data.packages.length} package row(s),
          ${AppState.data.items.length} inventory item(s).
          <strong>Save as PDF</strong> and <strong>Download Excel</strong> both
          use this new format; <strong>Legacy spreadsheet</strong> still exports
          the older flat template.
        </div>

        <div class="previewwrap"><iframe id="plPreview" title="Packing List preview"></iframe></div>
      </div>
    </div>`);

  container.appendChild(panel);
  panel.querySelector("#plGenerate").addEventListener("click", generatePl);
  panel.querySelector("#plExcel").addEventListener("click", generatePlNewXlsx);
  panel.querySelector("#plPrint").addEventListener("click", printPl);

  const refresh = () => updatePlPreview();
  panel.querySelector("#plFrom").addEventListener("change", refresh);
  panel.querySelector("#plTo").addEventListener("change", refresh);
  panel.querySelector("#plUnit").addEventListener("change", refresh);
  panel.querySelector("#plSigner").addEventListener("change", refresh);
  panel.querySelector("#plRefresh").addEventListener("click", refresh);

  updatePlPreview();
}

/* ── Live preview (HTML mirror of the generated .xlsx) ───────────────────── */

/** Today's date formatted DD-Mon-YYYY, matching the generated workbook. */
function _plToday() {
  const d = new Date();
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${String(d.getDate()).padStart(2,"0")}-${MON[d.getMonth()]}-${d.getFullYear()}`;
}

/** Read the current form selections. */
function plOptionsFromForm() {
  const unitSystem = (document.getElementById("plUnit") || {}).value || "imperial";
  const shipFrom = (document.getElementById("plFrom") || {}).value || "pickup";
  const shipTo = (document.getElementById("plTo") || {}).value || "deliver";
  const signerIdx = (document.getElementById("plSigner") || {}).value;
  let printedName = "";
  if (signerIdx !== "" && signerIdx != null) {
    const sg = SIGNERS[Number(signerIdx)];
    if (sg) printedName = `${sg.name}, ${sg.title}`;
  }
  return { unitSystem, shipFrom, shipTo, printedName };
}

/**
 * Convert one package to display values using the SAME math as _plFillPkgRow,
 * so the preview matches the downloaded workbook exactly.
 */
function _plPkgDisplay(pkg, pkgNo, unitSystem) {
  const desc = _plStripParens(pkg.description || "");
  const count = pkg.count || 1;
  const uoi = pkg.uoi || "";

  const wLbs = toFloat(pkg.weight_lbs), wKg = toFloat(pkg.weight_kg);
  let outWt = unitSystem === "imperial"
    ? (wLbs || (wKg ? wKg / 0.45359237 : null))
    : (wKg  || (wLbs ? wLbs * 0.45359237 : null));
  const wt = outWt != null
    ? (Math.round(outWt * 100) / 100).toLocaleString("en-US")
    : "";

  let L = "", W = "", H = "";
  const dims = _plParseDims(pkg.dims || "");
  if (dims) {
    const Lin = _plToIn(dims.L, dims.unit);
    const Win = _plToIn(dims.W, dims.unit);
    const Hin = _plToIn(dims.H, dims.unit);
    const [oL, oW, oH] = unitSystem === "imperial"
      ? [Lin, Win, Hin] : [Lin * 2.54, Win * 2.54, Hin * 2.54];
    L = Math.round(oL * 100) / 100;
    W = Math.round(oW * 100) / 100;
    H = Math.round(oH * 100) / 100;
  }
  return { pkgNo, desc, count, uoi, wt, L, W, H };
}

/* ── Parent/child grouping by Ship Group # ───────────────────────────────────
   A parent ("Serial #" == P) row may carry a Ship Group # value. Inventory
   items that were loaded into that box/pallet carry the SAME Ship Group #.
   We bucket items under their parent package; anything that doesn't match a
   package's group is shown in a "Loose / unassigned" block. Free-text groups
   are matched case-insensitively after trimming. */
function _plNormGroup(v) { return String(v == null ? "" : v).trim().toLowerCase(); }

function _plBuildGroups(data) {
  const items = data.items || [];
  const packages = data.packages || [];

  const itemsByGroup = {};
  for (const it of items) {
    const key = _plNormGroup(it.ship_group);
    (itemsByGroup[key] = itemsByGroup[key] || []).push(it);
  }

  // ── When does Ship Group # actually matter? ────────────────────────────────
  // Ship Group # only exists to say WHICH parent an item was loaded into. That
  // matters when there is more than one parent package, OR when the items carry
  // more than one distinct ship group (a mix — including a mix of "has a group"
  // and "no group"). If every item shares the same single group, or none of
  // them carry a group at all, and there is exactly ONE parent package, then
  // they're all on that one parent: nest them under it directly, regardless of
  // whether a Ship Group # was filled in. This avoids labeling everything
  // "Loose / unassigned" on a normal single-pallet (or single manual-parent)
  // shipment. (Multiple parents, or genuinely mixed groups, still bucket below.)
  const distinctItemKeys = new Set(items.map(it => _plNormGroup(it.ship_group)));
  const itemsVary = distinctItemKeys.size > 1;
  const groupingMatters = packages.length > 1 || itemsVary;
  if (!groupingMatters && packages.length === 1) {
    const pk = packages[0];
    return {
      grouped: false,
      crates: [{ pkg: pk, pkgNo: 1, group: pk.ship_group || "", kids: items.slice() }],
      loose: [],
      dupGroups: [],
    };
  }

  // Grouping is "on" only when at least one package declares a ship group AND
  // at least one item references a matching group. Otherwise we lay the list
  // out flat (every package is still its own card, items go in one Loose block).
  const pkgGroupKeys = new Set(
    packages.map(p => _plNormGroup(p.ship_group)).filter(Boolean));
  let grouped = pkgGroupKeys.size > 0 && items.length > 0;
  for (const it of items) {
    const k = _plNormGroup(it.ship_group);
    if (!(k && pkgGroupKeys.has(k))) { grouped = false; break; }
  }

  // Assign each ship group's items to the FIRST package that carries that group.
  // If more than one package row shares the same Ship Group #, the later ones
  // get no items (rather than a duplicate copy) — otherwise the same items would
  // be counted under every package sharing the key, inflating the unit/weight
  // totals. Duplicate package groups are collected so the UI can flag the UDQ.
  const claimed = new Set();
  const seenPkgKeys = new Set();
  const dupGroups = [];
  const crates = packages.map((pk, i) => {
    const key = _plNormGroup(pk.ship_group);
    let kids = [];
    if (grouped && key) {
      if (seenPkgKeys.has(key)) {
        // a previous package already owns this group's items
        if (!dupGroups.includes(pk.ship_group)) dupGroups.push(pk.ship_group);
      } else {
        seenPkgKeys.add(key);
        kids = itemsByGroup[key] || [];
        if (kids.length) claimed.add(key);
      }
    }
    return { pkg: pk, pkgNo: i + 1, group: pk.ship_group || "", kids };
  });

  // Items whose group matched no package (or that have no group at all). Counted
  // exactly once because each group is claimed by at most one crate above.
  const loose = items.filter(it => {
    const k = _plNormGroup(it.ship_group);
    return !(grouped && k && claimed.has(k));
  });

  return { grouped, crates, loose, dupGroups };
}

/** Build the printable HTML for the Packing List. */
function plRenderHtml(data, opts) {
  const m = data.meta;
  const raw = m.totals_raw || {};
  const unitSystem = opts.unitSystem;
  const wUnit = unitSystem === "imperial" ? "lbs" : "kg";

  const dateStr = _plToday();

  // Ship From / Ship To party selection (defaults: Pickup → Delivery Destination)
  const PARTY_LABELS = {
    pickup: "Pickup Location", origin: "Shipment Origin",
    deliver: "Delivery Destination", consignee: "Ultimate Consignee",
    intermediate: "Intermediate Consignee", end_user: "End User",
  };
  const fromKey = opts.shipFrom || "pickup";
  const toKey = opts.shipTo || "deliver";
  const pickup = _plPartyAddr(data.parties[fromKey]);
  const deliver = _plPartyAddr(data.parties[toKey]);
  const fromLabel = "Ship From — " + (PARTY_LABELS[fromKey] || "Pickup Location");
  const toLabel = "Ship To — " + (PARTY_LABELS[toKey] || "Delivery Destination");

  const { grouped, crates, loose } = _plBuildGroups(data);

  // ── per-package crate cards ──
  let totalUnits = 0;
  const cratesHtml = crates.map(c => {
    const d = _plPkgDisplay(c.pkg, c.pkgNo, unitSystem);
    const dims = (d.L !== "" && d.W !== "" && d.H !== "")
      ? `${esc(d.L)} × ${esc(d.W)} × ${esc(d.H)} ${unitSystem === "imperial" ? "in" : "cm"}`
      : "—";
    c.kids.forEach(k => totalUnits += (toFloat(k.units) || 0));
    const tag = c.group
      ? `<span class="pl-tag"><small>SHIP&nbsp;GRP</small> ${esc(c.group)}</span>` : "";
    const rows = c.kids.length
      ? c.kids.map((k, i) => `<tr>
          <td class="pl-num">${i + 1}</td>
          <td>${esc(k.desc)}</td>
          <td class="pl-mono">${esc(k.model)}</td>
          <td class="pl-mono c">${esc(k.hts)}</td>
          <td class="pl-mono r">${esc(k.units)}</td>
          <td class="c">${esc(k.uom)}</td></tr>`).join("")
      : `<tr><td colspan="6" class="pl-none">${grouped ? "No items assigned to this package" : "Contents listed in the inventory list below"}</td></tr>`;
    return `<div class="pl-crate">
      <div class="pl-crate-h">
        <span class="pl-pkgno">PKG ${String(d.pkgNo).padStart(2, "0")}</span>
        <span class="pl-crate-desc">${esc(d.desc) || "Package"}</span>
        ${tag}
      </div>
      <div class="pl-crate-m">
        <div class="cell"><div class="k">Gross weight</div><div class="v">${esc(d.wt) || "—"} ${esc(wUnit)}</div></div>
        <div class="cell"><div class="k">Dimensions</div><div class="v">${dims}</div></div>
        <div class="cell"><div class="k">Line items</div><div class="v">${c.kids.length}</div></div>
      </div>
      <table class="pl-items"><thead><tr>
        <th class="pl-num">#</th><th>Description</th><th>Model&nbsp;#</th>
        <th class="c">HS&nbsp;Code</th><th class="r">Qty</th><th class="c">U/I</th>
      </tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  }).join("");

  // ── loose / unassigned items ──
  let looseHtml = "";
  if (loose.length) {
    loose.forEach(k => totalUnits += (toFloat(k.units) || 0));
    const rows = loose.map((k, i) => `<tr>
      <td class="pl-num">${i + 1}</td>
      <td>${esc(k.desc)}</td>
      <td class="pl-mono">${esc(k.model)}</td>
      <td class="pl-mono c">${esc(k.hts)}</td>
      <td class="pl-mono r">${esc(k.units)}</td>
      <td class="c">${esc(k.uom)}</td></tr>`).join("");
    const isFlat = !grouped;
    const label = isFlat ? "Inventory items" : "Unassigned items — not tied to a ship group";
    const pill = isFlat ? "ITEMS" : "LOOSE";
    const cls = isFlat ? "" : " loose";
    looseHtml = `<div class="pl-crate${cls}">
      <div class="pl-crate-h"><span class="pl-pkgno">${pill}</span>
        <span class="pl-crate-desc">${label}</span></div>
      <table class="pl-items"><thead><tr>
        <th class="pl-num">#</th><th>Description</th><th>Model&nbsp;#</th>
        <th class="c">HS&nbsp;Code</th><th class="r">Qty</th><th class="c">U/I</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  const pkgCount = data.packages.length;
  const gross = unitSystem === "imperial"
    ? _plFmtWt(raw.udq_lbs || 0)
    : _plFmtWtKg(raw.udq_kg || 0);
  const cube = _plFmtVol(raw.udq_ft3 || 0);
  const grossChip = unitSystem === "imperial"
    ? `${_plFmtNum(raw.udq_lbs || 0)} lbs`
    : `${_plFmtNum(raw.udq_kg || 0)} kg`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Packing List</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${PL_CSS}</style></head><body>
<div class="pl-doc">
  <div class="pl-head">
    <div class="pl-brand">
      <span class="pl-brand-1">TRLS II</span>
      <span class="pl-brand-2">TechTrans International</span>
    </div>
    <div class="pl-ttl"><h1>Packing List</h1>
      <div class="sub"><b>${esc(m.wmtr)}</b> · ${esc(dateStr)}</div></div>
  </div>

  <div class="pl-route">
    <div class="end"><div class="lab">${esc(fromLabel)}</div><div class="val">${escBr(pickup) || "&mdash;"}</div></div>
    <div class="arrow">&rarr;</div>
    <div class="end"><div class="lab">${esc(toLabel)}</div><div class="val">${escBr(deliver) || "&mdash;"}</div></div>
  </div>

  <div class="pl-chips">
    <div class="chip"><div class="v">${pkgCount}</div><div class="k">Packages</div></div>
    <div class="chip"><div class="v">${Math.trunc(totalUnits).toLocaleString("en-US")}</div><div class="k">Total units</div></div>
    <div class="chip"><div class="v">${grossChip}</div><div class="k">Gross weight</div></div>
    <div class="chip"><div class="v">${esc(cube) || "—"}</div><div class="k">Volume</div></div>
  </div>

  <div class="pl-body">
    <div class="pl-sec">${grouped ? "Contents by package" : "Packages &amp; contents"}</div>
    ${cratesHtml || ""}${looseHtml ||
      (cratesHtml ? "" : `<div class="pl-crate"><div class="pl-none" style="padding:24px">No package or inventory data in this UDQ.</div></div>`)}
  </div>

  <div class="pl-foot">
    <div class="pl-foot-grid">
      <div class="pl-totals">
        <div class="row"><span class="k">Total number of packages</span><span class="v">${pkgCount}</span></div>
        <div class="row"><span class="k">Total units packed</span><span class="v">${Math.trunc(totalUnits).toLocaleString("en-US")}</span></div>
        <div class="row"><span class="k">Gross weight</span><span class="v">${esc(gross) || "—"}</span></div>
        <div class="row"><span class="k">WMTR number</span><span class="v">${esc(m.wmtr)}</span></div>
        ${(m._consol_secondaries && m._consol_secondaries.length) ? `<div class="row"><span class="k">Consolidated WMTRs</span><span class="v">${esc(m._consol_secondaries.join(", "))}</span></div>` : ""}
      </div>
      <div class="pl-sign">
        <div class="lab">Authorized by</div><div class="line"></div>
        <div class="name">${esc(opts.printedName) || "&nbsp;"}</div>
        <div class="lab" style="margin-top:10px">Date</div><div class="line"></div>
        <div class="name">${esc(dateStr)}</div>
      </div>
    </div>
    <div class="pl-prep">Prepared by TechTrans International (TTI) on behalf of the Defense Threat Reduction Agency (DTRA).</div>
    <div class="pl-boiler">These items are controlled by the U.S. Government and authorized for export only to the country of ultimate destination for use by the ultimate consignee or end-user(s) herein identified. They may not be resold, transferred, or otherwise disposed of to any other country or to any person other than the authorized ultimate consignee, without first obtaining approval from the U.S. Government or as otherwise authorized by U.S. law and regulations.</div>
  </div>
</div>
</body></html>`;
}

function updatePlPreview() {
  const iframe = document.getElementById("plPreview");
  if (!iframe) return;
  const opts = plOptionsFromForm();
  iframe.srcdoc = plRenderHtml(AppState.data, opts);
  const status = document.getElementById("plStatus");
  if (status && !status.classList.contains("err")) {
    // Warn (without blocking) when more than one package row shares a Ship Group #.
    // Those duplicates can't be assigned items unambiguously, so only the first
    // package gets them; flag it so the UDQ can be corrected in ATLAS.
    const { dupGroups } = _plBuildGroups(AppState.data);
    if (dupGroups && dupGroups.length) {
      const list = dupGroups.map(g => `“${g}”`).join(", ");
      status.textContent =
        `⚠ Ship Group ${list} is on more than one package — items counted once, ` +
        `under the first package only. Fix the duplicate Ship Group # in ATLAS.`;
      status.classList.add("warn");
    } else {
      status.classList.remove("warn");
      status.textContent =
        `Preview · ${AppState.data.packages.length} package row(s) · ${AppState.data.items.length} item(s)`;
    }
  }
  iframe.addEventListener("load", () => {
    try {
      const doc = iframe.contentDocument;
      doc.body.style.background = "transparent";
    } catch (e) { /* ignore */ }
  }, { once: true });
}

/** Filename stem for the PDF, mirroring the .xlsx naming. */
function plDocTitle() {
  const last5 = AppState.data.meta.wmtr_last5 || "UDQ";
  return `PL_${last5}_${fileStamp()}`;
}

/**
 * Open the rendered Packing List in a new window and trigger the browser's
 * print dialog. Choosing "Save as PDF" there produces a PDF that matches the
 * on-screen preview (same HTML, with the print @page rules in PL_CSS applied).
 */
function printPl() {
  if (typeof atlasGenerateGate === "function" && !atlasGenerateGate("pl", printPl)) return;
  const status = document.getElementById("plStatus");
  const html = plRenderHtml(AppState.data, plOptionsFromForm());
  const docTitle = plDocTitle();

  const w = window.open("", "_blank");
  if (!w) {
    if (status) {
      status.textContent =
        "Pop-up blocked — allow pop-ups for this page, then click Save as PDF again.";
      status.classList.add("err");
    }
    return;
  }
  if (status) { status.classList.remove("err"); status.textContent = "Opening print dialog…"; }

  w.document.open();
  w.document.write(html);
  w.document.close();
  w.document.title = docTitle;
  // Give the browser a beat to lay out fonts/tables, then print.
  setTimeout(() => { w.focus(); w.print(); }, 350);
}

const PL_CSS = `
:root{
  --ink:#16283C; --ink-2:#23364D; --steel:#5B6B7C; --paper:#EFF1F3;
  --line:#D4DAE0; --line-soft:#E7EBEF; --accent:#E8590C; --crate:#FBF7F2;
  --disp:"Barlow Condensed","Arial Narrow",Arial,sans-serif;
  --body:-apple-system,"Segoe UI",system-ui,Roboto,Arial,sans-serif;
  --mono:"IBM Plex Mono",Consolas,monospace;
}
*{ box-sizing:border-box; }
html,body{ margin:0; padding:0; background:var(--paper); }
body{ font-family:var(--body); color:var(--ink); padding:18px 14px 40px; }

.pl-doc{
  max-width:860px; margin:0 auto; background:#fff;
  border:1px solid var(--line); border-radius:10px; overflow:hidden;
  box-shadow:0 10px 30px rgba(22,40,60,.10);
}

/* Header band — dark, so the logo's black field reads as part of it */
.pl-head{
  background:var(--ink); color:#fff; display:flex; align-items:center;
  justify-content:space-between; gap:20px; padding:18px 24px;
  border-bottom:3px solid var(--accent);
}
.pl-brand{ display:flex; flex-direction:column; line-height:1; }
.pl-brand-1{ font-family:var(--disp); font-weight:700; font-size:30px; letter-spacing:2px; color:#fff; }
.pl-brand-2{ font-family:var(--disp); font-weight:500; font-size:12px; letter-spacing:3px;
  text-transform:uppercase; color:#9FB0C2; margin-top:5px; }
.pl-ttl{ text-align:right; }
.pl-ttl h1{ font-family:var(--disp); font-weight:700; letter-spacing:3px; text-transform:uppercase;
  font-size:32px; margin:0; line-height:.95; }
.pl-ttl .sub{ font-family:var(--mono); font-size:11px; color:#9FB0C2; letter-spacing:1px; margin-top:5px; }
.pl-ttl .sub b{ color:#fff; font-weight:600; }

/* Route strip */
.pl-route{ display:grid; grid-template-columns:1fr 42px 1fr; border-bottom:1px solid var(--line); }
.pl-route .end{ padding:13px 24px; }
.pl-route .lab{ font-family:var(--disp); text-transform:uppercase; letter-spacing:2px; font-size:11.5px;
  color:var(--accent); font-weight:600; margin-bottom:4px; }
.pl-route .val{ font-size:12.5px; line-height:1.4; white-space:pre-line; color:var(--ink-2); }
.pl-route .arrow{ display:flex; align-items:center; justify-content:center; color:var(--line);
  font-size:20px; background:#FAFBFC; border-left:1px solid var(--line-soft); border-right:1px solid var(--line-soft); }

/* Summary chips */
.pl-chips{ display:grid; grid-template-columns:repeat(4,1fr); border-bottom:1px solid var(--line); }
.pl-chips .chip{ padding:12px 18px; border-right:1px solid var(--line-soft); }
.pl-chips .chip:last-child{ border-right:0; }
.pl-chips .v{ font-family:var(--mono); font-weight:600; font-size:17px; }
.pl-chips .k{ font-family:var(--disp); text-transform:uppercase; letter-spacing:1.5px; font-size:10.5px; color:var(--steel); margin-top:1px; }

/* Body */
.pl-body{ padding:20px 24px 6px; }
.pl-sec{ font-family:var(--disp); text-transform:uppercase; letter-spacing:2px; font-size:13px;
  color:var(--steel); font-weight:600; display:flex; align-items:center; gap:10px; margin:2px 0 14px; }
.pl-sec::after{ content:""; flex:1; height:1px; background:var(--line-soft); }

/* Crate card = one parent package */
.pl-crate{ border:1px solid var(--line); border-radius:9px; overflow:hidden; margin-bottom:15px;
  break-inside:avoid; page-break-inside:avoid; }
.pl-crate-h{ display:flex; align-items:center; gap:12px; background:var(--ink); color:#fff; padding:10px 15px; }
.pl-crate.loose .pl-crate-h{ background:var(--ink-2); }
.pl-pkgno{ font-family:var(--mono); font-weight:600; font-size:12.5px; letter-spacing:1px;
  background:rgba(255,255,255,.10); border:1px solid rgba(255,255,255,.22); padding:3px 9px; border-radius:5px; white-space:nowrap; }
.pl-crate-desc{ font-family:var(--disp); font-size:17px; letter-spacing:.4px; font-weight:600;
  flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pl-tag{ font-family:var(--mono); font-size:11px; font-weight:600; letter-spacing:.5px;
  background:var(--accent); color:#fff; padding:3px 9px; border-radius:5px; white-space:nowrap; }
.pl-tag small{ font-weight:400; opacity:.85; letter-spacing:1px; }
.pl-crate-m{ display:flex; background:var(--crate); border-bottom:1px solid var(--line-soft); }
.pl-crate-m .cell{ padding:7px 15px; border-right:1px solid var(--line-soft); }
.pl-crate-m .cell:last-child{ border-right:0; }
.pl-crate-m .k{ font-family:var(--disp); text-transform:uppercase; letter-spacing:1px; font-size:10px; color:var(--steel); }
.pl-crate-m .v{ font-family:var(--mono); font-size:12.5px; }

table.pl-items{ width:100%; border-collapse:collapse; table-layout:fixed; }
table.pl-items th{ font-family:var(--disp); text-transform:uppercase; letter-spacing:1px; font-size:10px;
  color:var(--steel); text-align:left; padding:7px 15px; border-bottom:1px solid var(--line); background:#fff; font-weight:600; }
table.pl-items td{ padding:7px 15px; font-size:12.5px; border-bottom:1px solid var(--line-soft);
  vertical-align:top; word-wrap:break-word; overflow-wrap:break-word; }
table.pl-items tr:last-child td{ border-bottom:0; }
table.pl-items tbody tr:nth-child(even) td{ background:#FCFDFE; }
.pl-num{ width:30px; }
table.pl-items td.pl-num{ font-family:var(--mono); color:var(--steel); }
.pl-mono{ font-family:var(--mono); font-size:11.5px; }
table.pl-items .c{ text-align:center; }
table.pl-items .r{ text-align:right; }
.pl-none{ text-align:center; color:#9aa6b2; font-style:italic; padding:14px; }
/* column widths: # / desc / model / hs / qty / u-i */
table.pl-items th:nth-child(2),table.pl-items td:nth-child(2){ width:auto; }
table.pl-items th:nth-child(3),table.pl-items td:nth-child(3){ width:18%; }
table.pl-items th:nth-child(4),table.pl-items td:nth-child(4){ width:14%; }
table.pl-items th:nth-child(5),table.pl-items td:nth-child(5){ width:9%; }
table.pl-items th:nth-child(6),table.pl-items td:nth-child(6){ width:9%; }

/* Footer */
.pl-foot{ padding:18px 24px 22px; border-top:2px solid var(--ink); margin-top:4px; break-inside:avoid; page-break-inside:avoid; }
.pl-foot-grid{ display:grid; grid-template-columns:1.2fr 1fr; gap:26px; }
.pl-totals .row{ display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px dotted var(--line); font-size:12.5px; }
.pl-totals .row:last-child{ border-bottom:0; }
.pl-totals .row .k{ color:var(--steel); }
.pl-totals .row .v{ font-family:var(--mono); font-weight:600; }
.pl-sign .lab{ font-family:var(--disp); text-transform:uppercase; letter-spacing:1.5px; font-size:11px; color:var(--steel); }
.pl-sign .line{ border-bottom:1px solid var(--ink); height:28px; margin-bottom:3px; }
.pl-sign .name{ font-size:12.5px; font-weight:600; min-height:17px; }
.pl-prep{ font-size:11px; color:var(--steel); font-style:italic; margin-top:10px; }
.pl-boiler{ margin-top:14px; font-size:10px; line-height:1.45; color:var(--steel);
  background:#FAFBFC; border:1px solid var(--line-soft); border-radius:7px; padding:11px 14px; text-align:justify; }

/* ── Print / Save-as-PDF ──────────────────────────────────────────────────
   The on-screen scheme stays vivid; print mirrors it in a lighter gray-blue
   band + softer orange, with smaller type and tighter spacing so the manifest
   fits onto as few US-Letter pages as possible. Pagination keeps structural
   blocks intact, never orphans a package header, never splits a row, and
   repeats the column header on continued pages. */
@page{ size: 8.5in 11in; margin: 0.5in; }
@media print{
  html,body{ background:#fff; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .pl-doc{ max-width:none; border:0; border-radius:0; box-shadow:none; }

  /* Pagination */
  .pl-head, .pl-route, .pl-chips{ break-inside:avoid; page-break-inside:avoid; }
  .pl-sec{ break-after:avoid; page-break-after:avoid; }
  .pl-crate{ break-inside:auto; }
  .pl-crate-h, .pl-crate-m{ break-inside:avoid; break-after:avoid;
    page-break-inside:avoid; page-break-after:avoid; }
  table.pl-items thead{ display:table-header-group; }
  table.pl-items tr{ break-inside:avoid; page-break-inside:avoid; }
  .pl-foot{ break-inside:avoid; page-break-inside:avoid; }

  /* Lighter gray-blue band + softer orange, smaller type, tighter spacing */
  .pl-head{ background:#647A91; border-bottom:3px solid #E8924F; padding:9px 16px; gap:14px; }
  .pl-brand-1{ font-size:21px; letter-spacing:1.5px; }
  .pl-brand-2{ font-size:9px; letter-spacing:2px; color:#D6DEE6; margin-top:3px; }
  .pl-ttl h1{ font-size:22px; letter-spacing:2px; }
  .pl-ttl .sub{ font-size:9px; margin-top:3px; color:#D6DEE6; }
  .pl-route{ border-bottom:1px solid #CBD3DB; }
  .pl-route .end{ padding:7px 16px; }
  .pl-route .lab{ color:#CC7A36; font-size:9.5px; letter-spacing:1.5px; margin-bottom:2px; }
  .pl-route .val{ font-size:10px; line-height:1.3; }
  .pl-route .arrow{ color:#9AA6B2; background:#FAFBFC; }
  .pl-chips{ border-bottom:1px solid #CBD3DB; }
  .pl-chips .chip{ padding:6px 16px; border-right:1px solid #E1E6EB; }
  .pl-chips .v{ font-size:13px; }
  .pl-chips .k{ font-size:8.5px; letter-spacing:1px; }
  .pl-body{ padding:9px 16px 2px; }
  .pl-sec{ font-size:11px; margin:0 0 7px; }
  .pl-crate{ border:1px solid #CBD3DB; border-radius:4px; margin-bottom:7px; }
  .pl-crate-h{ background:#647A91; padding:4px 11px; gap:9px; }
  .pl-crate.loose .pl-crate-h{ background:#7C8CA0; }
  .pl-pkgno{ font-size:10px; padding:1px 7px; }
  .pl-crate-desc{ font-size:13px; letter-spacing:.3px; }
  .pl-tag{ background:#E8924F; font-size:9px; padding:1px 7px; }
  .pl-crate-m{ background:#F4F6F8; }
  .pl-crate-m .cell{ padding:3px 11px; border-right:1px solid #E1E6EB; }
  .pl-crate-m .k{ font-size:8px; }
  .pl-crate-m .v{ font-size:9.5px; }
  table.pl-items th{ font-size:8.5px; padding:3px 11px; color:#566B81; border-bottom:1px solid #CBD3DB; }
  table.pl-items td{ font-size:9.5px; padding:3px 11px; border-bottom:1px solid #E7EBEF; }
  .pl-mono{ font-size:9px; }
  table.pl-items td.pl-num{ font-size:9px; }
  .pl-foot{ padding:9px 16px 12px; border-top:2px solid #647A91; }
  .pl-foot-grid{ gap:20px; }
  .pl-totals .row{ padding:2px 0; font-size:9.5px; }
  .pl-sign .lab{ font-size:9.5px; }
  .pl-sign .line{ height:20px; }
  .pl-sign .name{ font-size:10px; }
  .pl-prep{ font-size:8.5px; margin-top:7px; }
  .pl-boiler{ font-size:7.5px; line-height:1.35; padding:7px 10px; margin-top:8px; }
}
@media (max-width:600px){
  .pl-chips{ grid-template-columns:repeat(2,1fr); }
  .pl-route{ grid-template-columns:1fr; }
  .pl-route .arrow{ display:none; }
  .pl-foot-grid{ grid-template-columns:1fr; }
}
`;


/* =========================================================================
   New Packing-List Excel generator (built from scratch — no template).
   Mirrors the redesigned PL: title band, Ship From/To, summary, per-package
   blocks with nested item rows, loose items, totals + signature, boilerplate.

   The OOXML is hand-built so we control fonts/fills/borders/merges (the bundled
   community SheetJS cannot write styles). _plXlsxParts() is pure (returns a
   {filename: xml} map) so it can be unit-tested outside the browser; the
   browser entry point generatePlNewXlsx() packs those parts with JSZip.
   ========================================================================= */

function _plColLetter(n) {            // 1 -> A, 27 -> AA
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}
function _plXmlEsc2(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* styles.xml — fixed catalogue of fonts/fills/borders and the cellXfs that
   combine them. Style indices are referenced by name via PLS below. */
function _plXlsxStyles() {
  const fonts = [
    `<font><sz val="10"/><name val="Calibri"/><color rgb="FF1B2A3A"/></font>`,                 // 0 default
    `<font><b/><sz val="10"/><name val="Calibri"/><color rgb="FF1B2A3A"/></font>`,              // 1 bold
    `<font><b/><sz val="16"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>`,              // 2 white bold 16
    `<font><sz val="9"/><name val="Calibri"/><color rgb="FFDDE4EA"/></font>`,                   // 3 white-ish 9
    `<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF566B81"/></font>`,              // 4 gray-blue bold 11
    `<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>`,              // 5 white bold 11
    `<font><b/><sz val="8"/><name val="Calibri"/><color rgb="FF566B81"/></font>`,               // 6 label bold 8
    `<font><sz val="9"/><name val="Calibri"/><color rgb="FF5B6B7C"/></font>`,                   // 7 gray 9
    `<font><b/><sz val="12"/><name val="Calibri"/><color rgb="FF1B2A3A"/></font>`,              // 8 bold 12
    `<font><b/><sz val="10"/><name val="Calibri"/><color rgb="FF1B2A3A"/></font>`,              // 9 bold 10
    `<font><sz val="8"/><name val="Calibri"/><color rgb="FF5B6B7C"/></font>`,                   // 10 gray 8
    `<font><b/><sz val="9"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>`,               // 11 white bold 9
  ];
  const fills = [
    `<fill><patternFill patternType="none"/></fill>`,                                            // 0
    `<fill><patternFill patternType="gray125"/></fill>`,                                         // 1
    `<fill><patternFill patternType="solid"><fgColor rgb="FF647A91"/></patternFill></fill>`,     // 2 band gray-blue
    `<fill><patternFill patternType="solid"><fgColor rgb="FFEAEEF2"/></patternFill></fill>`,     // 3 header light
    `<fill><patternFill patternType="solid"><fgColor rgb="FFF4F6F8"/></patternFill></fill>`,     // 4 manifest light
    `<fill><patternFill patternType="solid"><fgColor rgb="FFE8924F"/></patternFill></fill>`,     // 5 tag orange
  ];
  const thin = `<left style="thin"><color rgb="FFD0D7DE"/></left><right style="thin"><color rgb="FFD0D7DE"/></right><top style="thin"><color rgb="FFD0D7DE"/></top><bottom style="thin"><color rgb="FFD0D7DE"/></bottom><diagonal/>`;
  const borders = [
    `<border><left/><right/><top/><bottom/><diagonal/></border>`,   // 0 none
    `<border>${thin}</border>`,                                     // 1 thin box
  ];
  // alignment helper
  const AL = (h, v, w) => `<alignment${h ? ` horizontal="${h}"` : ""}${v ? ` vertical="${v}"` : ""}${w ? ` wrapText="1"` : ""}/>`;
  // xf(font, fill, border, align?) ; applyAlignment when align present
  const xf = (f, fl, b, al) =>
    `<xf numFmtId="0" fontId="${f}" fillId="${fl}" borderId="${b}" xfId="0"` +
    ` applyFont="1"${fl ? ' applyFill="1"' : ""}${b ? ' applyBorder="1"' : ""}${al ? ' applyAlignment="1"' : ""}>` +
    `${al || ""}</xf>`;
  const cellXfs = [
    xf(0, 0, 0),                              // 0 default
    xf(2, 2, 0, AL("left", "center")),       // 1 band brand
    xf(2, 2, 0, AL("right", "center")),      // 2 band title right
    xf(3, 2, 0, AL("left", "center")),       // 3 band sub left
    xf(3, 2, 0, AL("right", "center")),      // 4 band sub right
    xf(3, 2, 0),                              // 5 band blank
    xf(4, 0, 0, AL("left", "bottom")),       // 6 section label
    xf(6, 0, 0, AL("left", "center")),       // 7 field label
    xf(0, 0, 0, AL("left", "top", true)),    // 8 address wrap
    xf(8, 0, 0, AL("left", "center")),       // 9 chip value
    xf(7, 0, 0, AL("left", "center")),       // 10 chip key
    xf(5, 2, 0, AL("left", "center")),       // 11 group head text
    xf(5, 2, 0),                              // 12 group head blank
    xf(11, 5, 0, AL("right", "center")),     // 13 group tag
    xf(10, 4, 1, AL("left", "center")),      // 14 manifest cell
    xf(6, 3, 1, AL("center", "center")),     // 15 th center
    xf(6, 3, 1, AL("left", "center")),       // 16 th left
    xf(0, 0, 1, AL("left", "top", true)),    // 17 td left wrap
    xf(0, 0, 1, AL("center", "top")),        // 18 td center
    xf(0, 0, 1, AL("right", "top")),         // 19 td right
    xf(7, 0, 1, AL("center", "top")),        // 20 td num
    xf(0, 0, 0, AL("left", "center")),       // 21 totals label
    xf(1, 0, 0, AL("right", "center")),      // 22 totals value
    xf(7, 0, 0, AL("left", "center")),       // 23 sign label
    xf(10, 0, 0, AL("left", "top", true)),   // 24 boiler wrap
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="${fonts.length}">${fonts.join("")}</fonts>
<fills count="${fills.length}">${fills.join("")}</fills>
<borders count="${borders.length}">${borders.join("")}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${cellXfs.length}">${cellXfs.join("")}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

// Named style indices (must match _plXlsxStyles cellXfs order)
const PLS = {
  def:0, brand:1, titleR:2, subL:3, subR:4, bandBlank:5, section:6, fieldLab:7,
  addr:8, chipV:9, chipK:10, ghText:11, ghBlank:12, ghTag:13, manifest:14,
  thC:15, thL:16, tdL:17, tdC:18, tdR:19, tdNum:20, totL:21, totV:22, signLab:23, boiler:24,
};

/* Sheet writer: accumulates rows + merges, emits worksheet XML. */
function _PlSheetWriter() {
  this.rows = [];     // [{r, ht, cells:[{c,v,t,s}]}]
  this.merges = [];   // ["A1:F1"]
  this._r = 0;
}
_PlSheetWriter.prototype.addRow = function (cells, ht) {
  this._r += 1;
  const out = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell == null) continue;            // skip gaps
    out.push({ c: i + 1, v: cell.v, t: cell.t || (typeof cell.v === "number" ? "n" : "s"), s: cell.s || 0 });
  }
  this.rows.push({ r: this._r, ht: ht || 0, cells: out });
  return this._r;
};
_PlSheetWriter.prototype.merge = function (r1, c1, r2, c2) {
  this.merges.push(`${_plColLetter(c1)}${r1}:${_plColLetter(c2)}${r2}`);
};
_PlSheetWriter.prototype.lastRow = function () { return this._r; };
_PlSheetWriter.prototype.xml = function (cols) {
  const dim = `A1:${_plColLetter(6)}${this._r || 1}`;
  let sd = "";
  for (const row of this.rows) {
    let cellsXml = "";
    for (const c of row.cells) {
      const ref = `${_plColLetter(c.c)}${row.r}`;
      if (c.v == null || c.v === "") { cellsXml += `<c r="${ref}" s="${c.s}"/>`; continue; }
      if (c.t === "n") cellsXml += `<c r="${ref}" s="${c.s}"><v>${c.v}</v></c>`;
      else cellsXml += `<c r="${ref}" s="${c.s}" t="inlineStr"><is><t xml:space="preserve">${_plXmlEsc2(c.v)}</t></is></c>`;
    }
    const htAttr = row.ht ? ` ht="${row.ht}" customHeight="1"` : "";
    sd += `<row r="${row.r}"${htAttr}>${cellsXml}</row>`;
  }
  const colsXml = cols && cols.length
    ? `<cols>${cols.map(c => `<col min="${c.min}" max="${c.max}" width="${c.w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const mergeXml = this.merges.length
    ? `<mergeCells count="${this.merges.length}">${this.merges.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${dim}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="14"/>
${colsXml}<sheetData>${sd}</sheetData>${mergeXml}
<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup orientation="portrait" paperSize="1" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
};

/* Build the full set of OOXML parts for the new PL workbook. Pure function. */
function _plXlsxParts(data, opts) {
  const m = data.meta || {};
  const PARTY_LABELS = {
    pickup: "Pickup Location", origin: "Shipment Origin",
    deliver: "Delivery Destination", consignee: "Ultimate Consignee",
    intermediate: "Intermediate Consignee", end_user: "End User",
  };
  const fromKey = opts.shipFrom || "pickup";
  const toKey = opts.shipTo || "deliver";
  const unitSystem = opts.unitSystem || "imperial";
  const wUnit = unitSystem === "imperial" ? "lbs" : "kg";
  const fromAddr = _plPartyAddr(data.parties[fromKey]);
  const toAddr = _plPartyAddr(data.parties[toKey]);
  const raw = m.totals_raw || {};

  const { grouped, crates, loose } = _plBuildGroups(data);

  const S = new _PlSheetWriter();
  const C = (v, s, t) => ({ v, s, t });   // cell helper
  const blank = (s) => ({ v: "", s });

  // Title band (rows 1-2)
  S.addRow([C("TRLS II", PLS.brand), blank(PLS.bandBlank), blank(PLS.bandBlank),
            C("PACKING LIST", PLS.titleR), blank(PLS.bandBlank), blank(PLS.bandBlank)], 26);
  S.merge(1, 1, 1, 3); S.merge(1, 4, 1, 6);
  S.addRow([C("TechTrans International", PLS.subL), blank(PLS.bandBlank), blank(PLS.bandBlank),
            C(`${m.wmtr || ""}  ·  ${_plToday()}`, PLS.subR), blank(PLS.bandBlank), blank(PLS.bandBlank)], 16);
  S.merge(2, 1, 2, 2); S.merge(2, 3, 2, 6);

  S.addRow([]);  // spacer

  // Ship From / Ship To
  S.addRow([C("SHIP FROM — " + (PARTY_LABELS[fromKey] || ""), PLS.fieldLab), null, null,
            C("SHIP TO — " + (PARTY_LABELS[toKey] || ""), PLS.fieldLab)]);
  const rFrom = S.lastRow(); S.merge(rFrom, 1, rFrom, 3); S.merge(rFrom, 4, rFrom, 6);
  S.addRow([C(fromAddr || "—", PLS.addr), null, null, C(toAddr || "—", PLS.addr)], 58);
  const rAddr = S.lastRow(); S.merge(rAddr, 1, rAddr, 3); S.merge(rAddr, 4, rAddr, 6);

  S.addRow([]); // spacer

  // Summary (label / value pairs)
  let totalUnits = 0;
  crates.forEach(c => c.kids.forEach(k => totalUnits += (toFloat(k.units) || 0)));
  loose.forEach(k => totalUnits += (toFloat(k.units) || 0));
  const grossTxt = unitSystem === "imperial"
    ? `${_plFmtNum(raw.udq_lbs || 0)} lbs` : `${_plFmtNum(raw.udq_kg || 0)} kg`;
  S.addRow([C("PACKAGES", PLS.chipK), null, C("TOTAL UNITS", PLS.chipK), null,
            C("GROSS WEIGHT", PLS.chipK), null]);
  const rSL = S.lastRow(); S.merge(rSL, 1, rSL, 2); S.merge(rSL, 3, rSL, 4); S.merge(rSL, 5, rSL, 6);
  S.addRow([C(data.packages.length, PLS.chipV), null, C(Math.trunc(totalUnits), PLS.chipV), null,
            C(grossTxt, PLS.chipV), null]);
  const rSV = S.lastRow(); S.merge(rSV, 1, rSV, 2); S.merge(rSV, 3, rSV, 4); S.merge(rSV, 5, rSV, 6);

  S.addRow([]); // spacer

  // Section header
  S.addRow([C(grouped ? "CONTENTS BY PACKAGE" : "PACKAGES & CONTENTS", PLS.section)]);
  const rSec = S.lastRow(); S.merge(rSec, 1, rSec, 6);

  // Per-package blocks
  const writeItemHeader = () => {
    S.addRow([C("#", PLS.thC), C("Description", PLS.thL), C("Model #", PLS.thL),
              C("HS Code", PLS.thC), C("Qty", PLS.thC), C("U/I", PLS.thC)]);
  };
  const writeItemRow = (n, k) => {
    S.addRow([C(n, PLS.tdNum), C(k.desc, PLS.tdL), C(k.model, PLS.tdL),
              C(k.hts, PLS.tdC), C(toFloat(k.units) || 0, PLS.tdR), C(k.uom, PLS.tdC)]);
  };

  crates.forEach(c => {
    const d = _plPkgDisplay(c.pkg, c.pkgNo, unitSystem);
    const dims = (d.L !== "" && d.W !== "" && d.H !== "")
      ? `${d.L} x ${d.W} x ${d.H} ${unitSystem === "imperial" ? "in" : "cm"}` : "—";
    // group header row — "PKG 01 — description" (A:D) + ship-group tag (E:F)
    S.addRow([C("PKG " + String(d.pkgNo).padStart(2, "0") + (d.desc ? "  —  " + d.desc : ""), PLS.ghText),
              blank(PLS.ghBlank), blank(PLS.ghBlank), blank(PLS.ghBlank),
              C(c.group ? "SHIP GRP " + c.group : "", PLS.ghTag), blank(PLS.ghTag)], 19);
    const rgh = S.lastRow(); S.merge(rgh, 1, rgh, 4); S.merge(rgh, 5, rgh, 6);
    // manifest row
    S.addRow([C(`Gross: ${d.wt || "—"} ${wUnit}`, PLS.manifest), null,
              C(`Dimensions: ${dims}`, PLS.manifest), null,
              C(`Line items: ${c.kids.length}`, PLS.manifest), null]);
    const rm = S.lastRow(); S.merge(rm, 1, rm, 2); S.merge(rm, 3, rm, 4); S.merge(rm, 5, rm, 6);
    // items
    writeItemHeader();
    if (c.kids.length) c.kids.forEach((k, i) => writeItemRow(i + 1, k));
    else { S.addRow([C(grouped ? "No items assigned to this package" : "Contents listed in the inventory list below", PLS.tdC)]); const rn = S.lastRow(); S.merge(rn, 1, rn, 6); }
    S.addRow([]); // gap
  });

  if (loose.length) {
    S.addRow([C(grouped ? "LOOSE  —  Unassigned items (not tied to a ship group)" : "INVENTORY ITEMS", PLS.ghText),
              blank(PLS.ghBlank), blank(PLS.ghBlank), blank(PLS.ghBlank), blank(PLS.ghBlank), blank(PLS.ghBlank)], 19);
    const rgh = S.lastRow(); S.merge(rgh, 1, rgh, 6);
    writeItemHeader();
    loose.forEach((k, i) => writeItemRow(i + 1, k));
    S.addRow([]);
  }

  // Totals + signature
  S.addRow([]);
  const grossFull = unitSystem === "imperial"
    ? _plFmtWt(raw.udq_lbs || 0) : _plFmtWtKg(raw.udq_kg || 0);
  const totRow = (label, value) => {
    S.addRow([C(label, PLS.totL), null, C(value, PLS.totV), null, null, null]);
    const r = S.lastRow(); S.merge(r, 1, r, 2); S.merge(r, 3, r, 6);
  };
  totRow("Total number of packages", data.packages.length);
  totRow("Total units packed", Math.trunc(totalUnits));
  totRow("Gross weight", grossFull || "—");
  totRow("WMTR number", m.wmtr || "");
  if (m._consol_secondaries && m._consol_secondaries.length) {
    totRow("Consolidated WMTRs", m._consol_secondaries.join(", "));
  }

  S.addRow([]);
  S.addRow([C("AUTHORIZED BY", PLS.signLab), null, null, C("DATE", PLS.signLab)]);
  const rSign = S.lastRow(); S.merge(rSign, 1, rSign, 3); S.merge(rSign, 4, rSign, 6);
  S.addRow([C(opts.printedName || "", PLS.chipV), null, null, C(_plToday(), PLS.chipV)]);
  const rSign2 = S.lastRow(); S.merge(rSign2, 1, rSign2, 3); S.merge(rSign2, 4, rSign2, 6);

  S.addRow([]);
  S.addRow([C("Prepared by TechTrans International (TTI) on behalf of the Defense Threat Reduction Agency (DTRA).", PLS.signLab)]);
  const rPrep = S.lastRow(); S.merge(rPrep, 1, rPrep, 6);
  S.addRow([C("These items are controlled by the U.S. Government and authorized for export only to the country of ultimate destination for use by the ultimate consignee or end-user(s) herein identified. They may not be resold, transferred, or otherwise disposed of to any other country or to any person other than the authorized ultimate consignee, without first obtaining approval from the U.S. Government or as otherwise authorized by U.S. law and regulations.", PLS.boiler)], 48);
  const rBoil = S.lastRow(); S.merge(rBoil, 1, rBoil, 6);

  const cols = [
    { min: 1, max: 1, w: 5 },
    { min: 2, max: 2, w: 44 },
    { min: 3, max: 3, w: 16 },
    { min: 4, max: 4, w: 12 },
    { min: 5, max: 5, w: 8 },
    { min: 6, max: 6, w: 8 },
  ];
  const sheetXml = S.xml(cols);

  const parts = {};
  parts["[Content_Types].xml"] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
  parts["_rels/.rels"] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  parts["xl/workbook.xml"] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Packing List" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  parts["xl/_rels/workbook.xml.rels"] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  parts["xl/styles.xml"] = _plXlsxStyles();
  parts["xl/worksheets/sheet1.xml"] = sheetXml;
  return parts;
}

/* Browser entry point: pack the parts with JSZip and trigger a download. */
async function generatePlNewXlsx() {
  if (typeof atlasGenerateGate === "function" && !atlasGenerateGate("pl", generatePlNewXlsx)) return;
  const status = document.getElementById("plStatus");
  if (status) { status.classList.remove("err"); status.textContent = "Building Excel…"; }
  try {
    if (typeof JSZip === "undefined") throw new Error("JSZip is not available");
    const data = AppState.data, opts = plOptionsFromForm();
    const parts = _plXlsxParts(data, opts);
    const zip = new JSZip();
    for (const [name, content] of Object.entries(parts)) zip.file(name, content);
    const b64 = await zip.generateAsync({ type: "base64" });

    const last5 = data.meta.wmtr_last5 || "";
    const fname = (last5 ? `PL_${last5}_` : `PL_`) + fileStamp() + ".xlsx";
    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + b64;
    a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => document.body.removeChild(a), 1000);
    if (status) status.textContent = `✅ Downloaded ${fname}`;
  } catch (err) {
    console.error(err);
    if (status) { status.textContent = `Error: ${err.message}`; status.classList.add("err"); }
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function _plStripParens(s) {
  return (s || "").replace(/\s*\([^)]*\)/g, "").replace(/\s{2,}/g, " ").trim();
}
function _plFmtVol(ft3) {
  if (!ft3) return "";
  return `${ft3.toFixed(2)} ft\u00B3 (${(ft3 * 0.0283168466).toFixed(2)} m\u00B3)`;
}
function _plFmtWt(lbs) {
  if (!lbs) return "";
  return `${lbs.toFixed(2)} lbs (${(lbs * 0.45359237).toFixed(2)} kg)`;
}
function _plFmtWtKg(kg) {
  if (!kg) return "";
  return `${kg.toFixed(2)} kg (${(kg / 0.45359237).toFixed(2)} lbs)`;
}
function _plFmtNum(n) {
  if (!n) return "0";
  return (Math.round(n * 100) / 100).toLocaleString("en-US");
}
/** Address-only party block (org + address + country) for the route strip. */
function _plPartyAddr(party) {
  if (!party) return "";
  const lines = (party.addr_lines || []).filter(Boolean);
  if (party.country) lines.push(party.country);
  return lines.join("\n").trim();
}
function _plParseDims(s) {
  s = (s || "").trim();
  const uM = s.match(/\(([^)]+)\)/);
  let unit = uM ? uM[1].trim().toLowerCase() : "in";
  const uMap = {in:"in",inch:"in",inches:"in",cm:"cm",centimeter:"cm",
    centimeters:"cm",mm:"mm",millimeter:"mm",millimeters:"mm",
    ft:"ft",foot:"ft",feet:"ft"};
  unit = uMap[unit] || "in";
  const nums = s.match(/\d+(?:\.\d+)?/g) || [];
  if (nums.length < 3) return null;
  return {L:parseFloat(nums[0]),W:parseFloat(nums[1]),H:parseFloat(nums[2]),unit};
}
function _plToIn(v, unit) {
  if (unit==="cm") return v/2.54;
  if (unit==="mm") return v/25.4;
  if (unit==="ft") return v*12;
  return v;
}
function _plPartyBlock(party) {
  if (!party) return "";
  const lines = (party.addr_lines||[]).filter(Boolean);
  if (party.country) lines.push(party.country);
  const poc = [party.contact, party.phone, party.email].filter(Boolean);
  if (poc.length) lines.push(...poc);
  return lines.join("\n").trim();
}
function _xmlEsc(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* ── Shared-string table (pure string — no DOMParser/XMLSerializer) ─────── */

function PlStringTable(xml) {
  this._xml   = xml;
  this._map   = {};
  this._count = 0;

  // Parse existing entries: index each <si><t>…</t></si> by its text content
  const siRe = /<si>.*?<\/si>/gs;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const tM = m[0].match(/<t[^>]*>([\s\S]*?)<\/t>/);
    if (tM) this._map[tM[1]] = this._count;
    this._count++;
  }

  this.idx = function(str) {
    if (str in this._map) return this._map[str];
    // Escape XML special chars in the new string value
    const esc = str
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const spaceAttr = (str !== str.trim()) ? ' xml:space="preserve"' : '';
    const newSi = `<si><t${spaceAttr}>${esc}</t></si>`;
    // Insert before </sst>
    this._xml = this._xml.replace("</sst>", newSi + "</sst>");
    this._map[str] = this._count;
    return this._count++;
  };

  this.toXml = function() {
    // Set count and uniqueCount to the actual unique count
    return this._xml
      .replace(/\bcount="\d+"/, `count="${this._count}"`)
      .replace(/\buniqueCount="\d+"/, `uniqueCount="${this._count}"`);
  };
}

/* ── Sheet XML helpers ───────────────────────────────────────────────────── */

/**
 * Find and return the raw XML string for a <row> whose opening tag contains
 * r="N" (with a non-letter character immediately before the r= to avoid
 * matching cell addresses like <c r="A14"> when looking for r="4").
 */
function _plGetRow(xml, r) {
  const rAttr = `r="${r}"`;
  let search = 0;
  while (true) {
    const rowStart = xml.indexOf("<row ", search);
    if (rowStart === -1) return null;
    const tagEnd = xml.indexOf(">", rowStart);
    if (tagEnd === -1) return null;
    const openingTag = xml.slice(rowStart, tagEnd + 1);
    const rIdx = openingTag.indexOf(rAttr);
    if (rIdx !== -1) {
      const charBefore = rIdx > 0 ? openingTag[rIdx - 1] : " ";
      if (!/[A-Za-z]/.test(charBefore)) {
        const rowEnd = xml.indexOf("</row>", tagEnd);
        if (rowEnd === -1) return null;
        return xml.slice(rowStart, rowEnd + 6);
      }
    }
    search = tagEnd + 1;
  }
}

/**
 * Replace the exact occurrence of oldRowXml with newRowXml using indexOf
 * (not .replace(), which treats $ specially).
 */
function _plReplaceExact(xml, oldStr, newStr) {
  const idx = xml.indexOf(oldStr);
  if (idx === -1) return xml;
  return xml.slice(0, idx) + newStr + xml.slice(idx + oldStr.length);
}

/**
 * Set or update a cell in a row XML string.
 * type: "s"=shared-string index | "n"=number | "inline"=multiline text
 * Returns the updated row XML string.
 */
function _plSetCell(rowXml, addr, value, type) {
  let cellContent, typeAttr;
  if (type === "inline") {
    const esc = _xmlEsc(String(value)).replace(/\n/g, "&#10;");
    cellContent = `<is><t xml:space="preserve">${esc}</t></is>`;
    typeAttr    = ` t="inlineStr"`;
  } else if (type === "s") {
    cellContent = `<v>${value}</v>`;
    typeAttr    = ` t="s"`;
  } else {
    cellContent = `<v>${value}</v>`;
    typeAttr    = ``;
  }

  // Find existing cell and extract its s= style
  const cellRe = new RegExp(`<c [^>]*\\br="${addr}"[^>]*(?:/>|>.*?</c>)`, "s");
  const existM = rowXml.match(cellRe);
  let style = "10";
  if (existM) {
    const sm = existM[0].match(/\bs="(\d+)"/);
    if (sm) style = sm[1];
  } else {
    const rm = rowXml.match(/\bs="(\d+)"/);
    if (rm) style = rm[1];
  }

  const newCell = `<c r="${addr}" s="${style}"${typeAttr}>${cellContent}</c>`;
  if (existM) {
    return _plReplaceExact(rowXml, existM[0], newCell);
  } else {
    return rowXml.replace("</row>", newCell + "</row>");
  }
}

/**
 * Clone a row, replacing its r= attribute and all cell addresses with tempR.
 * Use a high tempR (e.g. 9000+) to avoid colliding with existing rows.
 */
function _plCloneRow(xml, srcR, tempR) {
  const src = _plGetRow(xml, srcR);
  if (!src) return null;
  // Update row r= attribute (use function to avoid $1 collision with tempR)
  let clone = src.replace(/(<row [^>]*\br=")(\d+)(")/, (_, a, _r, b) => a + tempR + b);
  // Update all cell addresses in the row
  clone = clone.replace(/\br="([A-Z]+)\d+"/g, (_, col) => `r="${col}${tempR}"`);
  return clone;
}

/**
 * Walk the entire XML in document order, renumbering every <row> element
 * sequentially (1, 2, 3, …). Also updates cell addresses inside each row.
 * Returns the renumbered XML.
 */
function _plRenumberRows(xml) {
  const parts = [];
  let lastEnd  = 0;
  let rCounter = 0;
  let search   = 0;

  while (true) {
    const rowStart = xml.indexOf("<row ", search);
    if (rowStart === -1) { parts.push(xml.slice(lastEnd)); break; }

    const tagEnd = xml.indexOf(">", rowStart);
    if (tagEnd === -1) { parts.push(xml.slice(lastEnd)); break; }

    const rowEnd = xml.indexOf("</row>", tagEnd);
    if (rowEnd === -1) { parts.push(xml.slice(lastEnd)); break; }

    rCounter++;
    const rowXml  = xml.slice(rowStart, rowEnd + 6);
    const origR   = parseInt((xml.slice(rowStart, tagEnd + 1).match(/\br="(\d+)"/) || [,"0"])[1], 10);

    // Update row r= attribute (use function to avoid $1 collision with counter)
    let newRowXml = rowXml.replace(/(<row [^>]*\br=")(\d+)(")/, (_, a, _r, b) => a + rCounter + b);
    // Update all cell addresses if row number changed
    if (origR !== rCounter) {
      newRowXml = newRowXml.replace(/\br="([A-Z]+)\d+"/g, (_, col) => `r="${col}${rCounter}"`);
    }

    parts.push(xml.slice(lastEnd, rowStart));
    parts.push(newRowXml);
    lastEnd = rowEnd + 6;
    search  = rowEnd + 6;
  }

  return parts.join("");
}

/* ── Main generator ──────────────────────────────────────────────────────── */

async function generatePl() {
  if (typeof atlasGenerateGate === "function" && !atlasGenerateGate("pl", generatePl)) return;
  const status = document.getElementById("plStatus");
  status.textContent = "Loading…";
  status.classList.remove("err");



  try {
    status.textContent = "Generating…";

    const unitSystem = document.getElementById("plUnit").value;
    const signerIdx  = document.getElementById("plSigner").value;
    const data       = AppState.data;
    const m          = data.meta;
    const raw        = m.totals_raw;
    const packages   = data.packages;
    const items      = data.items;

    /* ── Load template ── */
    const b64 = unitSystem === "metric" ? PL_TEMPLATE_METRIC_B64 : PL_TEMPLATE_IMPERIAL_B64;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const zip = await JSZip.loadAsync(bytes);

    let xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
    const st = new PlStringTable(await zip.file("xl/sharedStrings.xml").async("string"));

    /* ── Date & signer ── */
    const today = new Date();
    const MON   = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const dateStr = `${String(today.getDate()).padStart(2,"0")}-${MON[today.getMonth()]}-${today.getFullYear()}`;
    let printedName = "";
    if (signerIdx !== "") {
      const sg = SIGNERS[Number(signerIdx)];
      printedName = `${sg.name}, ${sg.title}`;
    }

    /* ═══════════════════════════════════════════════════════════════════
       STEP 1 — Edit all cells at their ORIGINAL template row numbers.
       This must happen before any row insertions so the row numbers
       in the XML still match the template layout.
    ═══════════════════════════════════════════════════════════════════ */

    // Helper: read row, edit cells, write back
    const editRow = (r, fn) => {
      const rx = _plGetRow(xml, r);
      if (!rx) return;
      const updated = fn(rx);
      xml = _plReplaceExact(xml, rx, updated);
    };

    // Row 4: address blocks
    editRow(4, rx => {
      rx = _plSetCell(rx, "A4", _plPartyBlock(data.parties.pickup),  "inline");
      rx = _plSetCell(rx, "O4", _plPartyBlock(data.parties.deliver), "inline");
      // Row height is stored in POINTS. The user's display shows the template's
      // 60pt as 120px (2 px/pt at 150% scaling), so 162px target = 81pt.
      rx = rx.replace(/(<row [^>]*\br="4"[^>]*?)\bht="[\d.]+"/,
                      (_, pre) => pre + 'ht="81"');
      if (!/\bcustomHeight=/.test((rx.match(/<row [^>]*>/) || [""])[0])) {
        rx = rx.replace(/(<row [^>]*\br="4"[^>]*?)>/,
                        (_, pre) => pre + ' customHeight="1">');
      }
      return rx;
    });

    // Row 7: date + WMTR
    editRow(7, rx => {
      rx = _plSetCell(rx, "A7", st.idx(dateStr), "s");
      if (m.wmtr) rx = _plSetCell(rx, "G7", st.idx(m.wmtr), "s");
      return rx;
    });

    // Row 10: first package value row
    if (packages.length > 0) {
      editRow(10, rx => _plFillPkgRow(rx, 10, 1, packages[0], unitSystem, st));
    }

    // Row 13: first inventory item row
    if (items.length > 0) {
      editRow(13, rx => _plFillInvRow(rx, 13, items[0], st));
    }

    // Footer rows (original positions 14–23)
    editRow(16, rx => _plSetCell(rx, "C16", packages.length, "n"));
    if (printedName) editRow(18, rx => _plSetCell(rx, "R18", st.idx(printedName), "s"));
    // Footer date under the Printed Name (R20). The template ships this as a
    // formula (=A7) with a cached 0; writing the date literally makes it always
    // display and removes the sheet's only formula (so the calc chain is moot).
    editRow(20, rx => _plSetCell(rx, "R20", st.idx(dateStr), "s"));
    const volStr = _plFmtVol(raw.udq_ft3 || 0);
    if (volStr) editRow(19, rx => _plSetCell(rx, "C19", st.idx(volStr), "s"));
    const wtStr  = _plFmtWt(raw.udq_lbs || 0);
    if (wtStr)  editRow(23, rx => _plSetCell(rx, "C23", st.idx(wtStr),  "s"));

    /* ═══════════════════════════════════════════════════════════════════
       STEP 2 — Insert extra package blocks using TEMP row numbers.
       Template pkg block = rows 9 (hdr) / 10 (val) / 11 (spacer).
       Extra blocks go before the original row 12 (inventory header).
       Each extra block gets temp rows 9000+, 9001+, 9002+, etc.
    ═══════════════════════════════════════════════════════════════════ */

    let tempBase = 9000;

    for (let pi = 1; pi < packages.length; pi++) {
      const tHdr = tempBase++;
      const tVal = tempBase++;
      const tSpc = tempBase++;

      const newHdr = _plCloneRow(xml, 9,  tHdr);
      const newVal = _plCloneRow(xml, 10, tVal);
      const newSpc = _plCloneRow(xml, 11, tSpc);

      if (!newHdr || !newVal || !newSpc) continue;

      // Insert all three before the original row 12
      const row12 = _plGetRow(xml, 12);
      if (!row12) continue;
      const ins12 = xml.indexOf(row12);
      xml = xml.slice(0, ins12) + newHdr + newVal + newSpc + xml.slice(ins12);

      // Fill the temp value row with package data
      const tValXml = _plGetRow(xml, tVal);
      if (tValXml) {
        const filled = _plFillPkgRow(tValXml, tVal, pi + 1, packages[pi], unitSystem, st);
        xml = _plReplaceExact(xml, tValXml, filled);
      }
    }

    /* ═══════════════════════════════════════════════════════════════════
       STEP 3 — Insert extra inventory rows using TEMP row numbers.
       Extra rows go before the original row 14 (footer separator).
    ═══════════════════════════════════════════════════════════════════ */

    for (let ii = 1; ii < items.length; ii++) {
      const tRow = tempBase++;
      const newRow = _plCloneRow(xml, 13, tRow);
      if (!newRow) continue;

      const row14 = _plGetRow(xml, 14);
      if (!row14) continue;
      const ins14 = xml.indexOf(row14);
      xml = xml.slice(0, ins14) + newRow + xml.slice(ins14);

      const tRowXml = _plGetRow(xml, tRow);
      if (tRowXml) {
        const filled = _plFillInvRow(tRowXml, tRow, items[ii], st);
        xml = _plReplaceExact(xml, tRowXml, filled);
      }
    }

    /* ═══════════════════════════════════════════════════════════════════
       STEP 4 — Renumber ALL rows sequentially in document order.
       This resolves temp numbers and produces a clean r=1,2,3,… sequence.
    ═══════════════════════════════════════════════════════════════════ */

    xml = _plRenumberRows(xml);

    /* ═══════════════════════════════════════════════════════════════════
       STEP 5 — Update <dimension> and <mergeCells>.
    ═══════════════════════════════════════════════════════════════════ */

    // Count final rows
    const finalRowCount = (xml.match(/<row /g) || []).length;

    // Update dimension
    xml = xml.replace(/(<dimension ref="[^:]+:)[A-Z]+\d+(")/,
      (_, pre, suf) => `${pre}AB${finalRowCount}${suf}`);

    // Shift merge ranges: original rows 1-11 unchanged, 12+ shift by totalShift.
    // totalShift = finalRowCount - 23 (original row count).
    const totalShift = finalRowCount - 23;
    if (totalShift > 0) {
      xml = xml.replace(/<mergeCells[^>]*>.*?<\/mergeCells>/s, full =>
        full.replace(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g,
          (_, c1, r1, c2, r2) => {
            const n1 = parseInt(r1,10), n2 = parseInt(r2,10);
            const s1 = n1 >= 12 ? n1 + totalShift : n1;
            const s2 = n2 >= 12 ? n2 + totalShift : n2;
            return `<mergeCell ref="${c1}${s1}:${c2}${s2}"/>`;
          })
      );
    }

    // Add missing merges for extra package blocks.
    // The template has merges for pkg rows 9 and 10 only. Each extra pkg block
    // (after renumber) sits at rows 9+(i*3) and 9+(i*3)+1 for i=1,2,...
    // We replicate the row-9 and row-10 merge patterns for each extra block.
    if (packages.length > 1) {
      // Extract the set of merges that exist for rows 9 and 10 from the final XML
      const mergeSection = xml.match(/<mergeCells[^>]*>([\s\S]*?)<\/mergeCells>/);
      if (mergeSection) {
        const existingMerges = mergeSection[1];
        const pkgMerges9  = [];
        const pkgMerges10 = [];
        const mRe = /<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g;
        let mm;
        while ((mm = mRe.exec(existingMerges)) !== null) {
          const r1 = parseInt(mm[2], 10), r2 = parseInt(mm[4], 10);
          if (r1 === 9  && r2 === 9)  pkgMerges9.push( [mm[1], mm[3]]);
          if (r1 === 10 && r2 === 10) pkgMerges10.push([mm[1], mm[3]]);
        }
        // Build new merge entries for each extra pkg block
        let newMerges = "";
        for (let pi = 1; pi < packages.length; pi++) {
          const baseR = 9 + pi * 3;
          for (const [c1, c2] of pkgMerges9) {
            newMerges += `<mergeCell ref="${c1}${baseR}:${c2}${baseR}"/>`;
          }
          for (const [c1, c2] of pkgMerges10) {
            newMerges += `<mergeCell ref="${c1}${baseR+1}:${c2}${baseR+1}"/>`;
          }
        }
        if (newMerges) {
          // Update count and insert new merges
          xml = xml.replace(/<mergeCells count="(\d+)">/,
            (_, cnt) => `<mergeCells count="${parseInt(cnt,10) + newMerges.split("<mergeCell").length - 1}">`);
          xml = xml.replace("</mergeCells>", newMerges + "</mergeCells>");
        }
      }
    }

    /* ── Repack and download ── */
    // Build a fresh JSZip to avoid generateAsync ignoring in-place modifications
    let wbXml = await zip.file("xl/workbook.xml").async("string");
    wbXml = wbXml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, "");

    // The footer "Printed Name" date cell carries a formula (=A7). We drop the
    // stale calcChain entirely (rather than ship an empty one, which Excel flags
    // as unreadable content) and force a full recalc on load so that formula —
    // and any others — re-evaluates and shows today's date instead of a cached 0.
    if (/<calcPr\b[^>]*\/>/.test(wbXml)) {
      wbXml = wbXml.replace(/<calcPr\b([^>]*?)\s*\/>/, (full, attrs) => {
        let a = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "");
        return `<calcPr${a} fullCalcOnLoad="1"/>`;
      });
    } else {
      wbXml = wbXml.replace(/<\/workbook>/, '<calcPr fullCalcOnLoad="1"/></workbook>');
    }

    // Strip the calcChain declaration from Content Types and the workbook rels,
    // so the part can be omitted without leaving a dangling reference.
    let ctXml = await zip.file("[Content_Types].xml").async("string");
    ctXml = ctXml.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, "");

    let wbRels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
    wbRels = wbRels.replace(/<Relationship[^>]*Target="calcChain\.xml"[^>]*\/>/, "");

    const outZip = new JSZip();
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      if (name === "xl/worksheets/sheet1.xml") {
        outZip.file(name, xml);
      } else if (name === "xl/sharedStrings.xml") {
        outZip.file(name, st.toXml());
      } else if (name === "xl/workbook.xml") {
        outZip.file(name, wbXml);
      } else if (name === "[Content_Types].xml") {
        outZip.file(name, ctXml);
      } else if (name === "xl/_rels/workbook.xml.rels") {
        outZip.file(name, wbRels);
      } else if (name === "xl/calcChain.xml") {
        // Intentionally omitted — Excel rebuilds the calc chain on open.
        continue;
      } else {
        outZip.file(name, await entry.async("uint8array"));
      }
    }

    // Use base64 data: URL instead of blob: URL to avoid file:// origin restrictions
    const outB64 = await outZip.generateAsync({type:"base64"});
    const last5 = m.wmtr_last5 || "";
    const stamp  = fileStamp();
    const fname  = last5 ? `PL_${last5}_${stamp}.xlsx` : `PL_${stamp}.xlsx`;

    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + outB64;
    a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => document.body.removeChild(a), 1000);

    status.textContent = `✅ Downloaded ${fname}`;

  } catch (err) {
    console.error(err);
    status.textContent = `Error: ${err.message}`;
    status.classList.add("err");
  }
}

/* ── Fill a package value row ── */
function _plFillPkgRow(rowXml, r, pkgNo, pkg, unitSystem, st) {
  rowXml = _plSetCell(rowXml, `A${r}`, pkgNo, "n");
  const desc = _plStripParens(pkg.description || "");
  if (desc) rowXml = _plSetCell(rowXml, `C${r}`, st.idx(desc), "s");
  rowXml = _plSetCell(rowXml, `N${r}`, pkg.count || 1, "n");
  if (pkg.uoi) rowXml = _plSetCell(rowXml, `Q${r}`, pkg.uoi, "inline");

  const wLbs = toFloat(pkg.weight_lbs), wKg = toFloat(pkg.weight_kg);
  let outWt = unitSystem === "imperial"
    ? (wLbs || (wKg ? wKg / 0.45359237 : null))
    : (wKg  || (wLbs ? wLbs * 0.45359237 : null));
  if (outWt != null)
    rowXml = _plSetCell(rowXml, `S${r}`, Math.round(outWt * 100) / 100, "n");

  const dims = _plParseDims(pkg.dims || "");
  if (dims) {
    const Lin = _plToIn(dims.L, dims.unit);
    const Win = _plToIn(dims.W, dims.unit);
    const Hin = _plToIn(dims.H, dims.unit);
    const [oL,oW,oH] = unitSystem === "imperial"
      ? [Lin, Win, Hin] : [Lin*2.54, Win*2.54, Hin*2.54];
    rowXml = _plSetCell(rowXml, `W${r}`,  Math.round(oL*100)/100, "n");
    rowXml = _plSetCell(rowXml, `Y${r}`,  Math.round(oW*100)/100, "n");
    rowXml = _plSetCell(rowXml, `AA${r}`, Math.round(oH*100)/100, "n");
  }
  return rowXml;
}

/* ── Fill an inventory item row ── */
function _plFillInvRow(rowXml, r, item, st) {
  if (item.desc)  rowXml = _plSetCell(rowXml, `C${r}`,  st.idx(item.desc),  "s");
  if (item.model) rowXml = _plSetCell(rowXml, `P${r}`,  st.idx(item.model), "s");
  if (item.hts)   rowXml = _plSetCell(rowXml, `V${r}`,  st.idx(item.hts),   "s");
  const qtyN = toFloat(item.units);
  if (qtyN)       rowXml = _plSetCell(rowXml, `Y${r}`,  qtyN, "n");
  // Z (U/I) must be written AFTER Y — the regex for Y13 self-closing would
  // otherwise swallow the following Z inlineStr cell in its match.
  if (item.uom)   rowXml = _plSetCell(rowXml, `Z${r}`,  item.uom,  "inline");
  return rowXml;
}
