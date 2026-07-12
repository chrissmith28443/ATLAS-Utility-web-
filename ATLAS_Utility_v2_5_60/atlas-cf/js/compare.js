/* =========================================================================
   ATLAS Utility Web — compare.js
   UDQ compare / diff between TWO SRF UDQs, loaded into two slots:

     UDQ A ("Was")  vs  UDQ B ("Now")

   Each slot accepts a drop / click-to-browse (.xlsx) OR a direct fetch from
   ATLAS by WMTR number (same session-cookie path as the header ATLAS button;
   see json_udq.js). If an SRF UDQ is already loaded in the app, it pre-fills
   slot A — but either slot can still be replaced with any file or fetch, so
   two arbitrary UDQs can be compared without touching what's loaded.

   The diff covers shipment header fields, parties, EVERY captured inventory
   line-item data element (see makeLineItem in udq.js), and package ("P") rows.
   Everything is parsed in-memory only; nothing replaces the loaded UDQ and
   nothing is persisted.
   ========================================================================= */

const _CMP_META_FIELDS = [
  ["WMTR", (m) => m.wmtr],
  ["Request title", (m) => m.request_title],
  ["Contract no.", (m) => m.contract_no],
  ["Origin country", (m) => m.country_origin],
  ["Destination country", (m) => m.country_destination],
  ["Value of cargo", (m) => m.value_of_cargo],
  ["Total weight", (m) => m.total_weight],
  ["Special handling", (m) => m.special_handling],
  ["CTR program", (m) => m.ctr_program],
];

const _CMP_PARTY_KEYS = [
  ["Origin", "origin"], ["Consignee", "consignee"], ["Intermediate", "intermediate"],
  ["End user", "end_user"], ["Pickup", "pickup"], ["Deliver", "deliver"],
];

/* Every data element readUdq captures per line item (mirrors makeLineItem in
   udq.js). Description and Model are the pairing key, so they're compared in
   the second-pass matcher below (_CMP_ITEM_FIELDS_FULL) rather than here. */
const _CMP_ITEM_FIELDS = [
  ["Units", "units"], ["UoM", "uom"], ["Unit value", "unit_value"], ["Total value", "total_value"],
  ["Weight (lbs)", "weight_lbs"], ["Weight (kg)", "weight_kg"],
  ["HTS", "hts"], ["ECCN/USML", "eccn"], ["Authorization", "auth"], ["COO", "coo"],
  ["UN code", "un_code"], ["Hazard class", "hazmat_class"],
  ["Temp control", "temp_control"], ["Shelf life", "shelf_life"],
  ["Manufacturer", "manufacturer"], ["Vendor", "vendor"], ["Serial", "serial"],
  ["PO", "purchase_order"], ["Ship group", "ship_group"],
];

/* Second-pass pairing (matched on Model alone, or Description alone) compares
   the full set INCLUDING Description/Model, so an edited description or model
   number reports as a field change instead of a removed+added pair. */
const _CMP_ITEM_FIELDS_FULL = [
  ["Description", "desc"], ["Model/Catalog #", "model"],
].concat(_CMP_ITEM_FIELDS);

/* Package ("P") rows from the Inventory List (see readUdq packages[]). */
const _CMP_PKG_FIELDS = [
  ["Count", "count"], ["UoI", "uoi"],
  ["Weight (lbs)", "weight_lbs"], ["Weight (kg)", "weight_kg"],
  ["Dims", "dims"], ["Description", "description"],
];

function _cmpStr(v) { return (typeof normWs === "function" ? normWs(v) : String(v == null ? "" : v).trim()); }

/* Interpret a value as a SINGLE number, tolerating money/quantity formatting:
   a leading currency symbol, thousands commas, surrounding spaces, a trailing %.
   Returns null for anything that isn't a clean whole number — crucially, for
   alphanumeric identifiers like model numbers ("CW-C341464-2-75FT"), HTS codes
   ("8544.49.3080"), and ECCNs, which must be compared as text, not coerced to a
   float (parseFloat stops at the first stray dash and collapses distinct codes). */
function _cmpNumeric(s) {
  const t = String(s).replace(/[\s$]/g, "").replace(/,(?=\d{3})/g, "").replace(/%$/, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null;
  const n = parseFloat(t);
  return isFinite(n) ? n : null;
}

function _cmpEqual(a, b) {
  const sa = _cmpStr(a), sb = _cmpStr(b);
  if (sa === sb) return true;
  const na = _cmpNumeric(sa), nb = _cmpNumeric(sb);
  if (na !== null && nb !== null) return Math.abs(na - nb) < 0.005;
  return false;
}

function _cmpItemKey(it) {
  const model = _cmpStr(it.model).toUpperCase();
  const desc = _cmpStr(it.desc).toUpperCase();
  const k = (model + "\u00A6" + desc).replace(/^\u00A6|\u00A6$/g, "");
  return k || ("LINE:" + it.line);
}

function _cmpItemLabel(it) {
  return _cmpStr(it.desc) || _cmpStr(it.model) || ("Line " + it.line);
}

function _cmpPkgKey(p) {
  const k = (_cmpStr(p.ship_group) || _cmpStr(p.description)).toUpperCase();
  return k || ("ROW:" + p.row);
}

function _cmpPkgLabel(p) {
  const d = _cmpStr(p.description), g = _cmpStr(p.ship_group);
  if (d && g) return `${d} (ship group ${g})`;
  return d || (g ? `Ship group ${g}` : "Package");
}

/* Full-field signature of a record, used to cancel identical rows up front. */
function _cmpSig(rec, fields) {
  return fields.map(([, f]) => _cmpStr(rec[f]).toUpperCase()).join("\u241F");
}

/**
 * Robustly match two lists of records (inventory items or packages) and classify
 * them as changed / removed / added — WITHOUT pairing by position, which mis-aligns
 * when a middle record is removed and every sibling shifts up a slot.
 *
 *   1. Cancel exact-equal records first (identical across every compared field),
 *      so unchanged rows can never be mistaken for a "change" against a shifted
 *      neighbour.
 *   2. Pair whatever's left using each key function in turn (strict -> loose), but
 *      ONLY when a key identifies exactly one unused record on each side. Ambiguous
 *      groups (several records sharing a key, e.g. many blank-ship-group pallets)
 *      are left for the next key, and ultimately reported as removed/added rather
 *      than guessed into false "changes."
 *
 * keyList : array of key functions, strict first (a "" key means "skip this tier").
 * fields  : [label, field] pairs to diff.
 * labelFn : record -> display label.
 */
function _cmpMatch(listA, listB, keyList, fields, labelFn) {
  let A = listA.slice(), B = listB.slice();
  const changed = [];

  // Tier 1 — cancel exact full-signature matches (order-independent).
  const sigMap = new Map();
  B.forEach((it, i) => {
    const s = _cmpSig(it, fields);
    if (!sigMap.has(s)) sigMap.set(s, []);
    sigMap.get(s).push(i);
  });
  const usedB = new Set();
  A = A.filter((ia) => {
    const idxs = sigMap.get(_cmpSig(ia, fields));
    if (idxs) while (idxs.length) { const c = idxs.shift(); if (!usedB.has(c)) { usedB.add(c); return false; } }
    return true;
  });
  B = B.filter((_, i) => !usedB.has(i));

  // Tiers 2..n — pair remaining records only on an unambiguous key match.
  for (const keyFn of keyList) {
    if (!A.length || !B.length) break;
    const mapB = new Map();
    B.forEach((it, i) => {
      const k = keyFn(it);
      if (!k) return;
      if (!mapB.has(k)) mapB.set(k, []);
      mapB.get(k).push(i);
    });
    const takenB = new Set();
    const nextA = [];
    for (const ia of A) {
      const k = keyFn(ia);
      const cands = k && mapB.get(k) ? mapB.get(k).filter((i) => !takenB.has(i)) : [];
      if (cands.length !== 1) { nextA.push(ia); continue; }   // 0 or many -> don't guess
      const ib = B[cands[0]];
      takenB.add(cands[0]);
      const changes = [];
      for (const [label, f] of fields) {
        if (!_cmpEqual(ia[f], ib[f])) changes.push({ field: label, old: _cmpStr(ia[f]), new: _cmpStr(ib[f]) });
      }
      if (changes.length) changed.push({ label: labelFn(ib), line: ib.line, changes });
    }
    A = nextA;
    B = B.filter((_, i) => !takenB.has(i));
  }

  return {
    changed,
    removed: A.map((it) => ({ label: labelFn(it), line: it.line })),
    added: B.map((it) => ({ label: labelFn(it), line: it.line })),
  };
}

/** Diff two SRF UDQ data objects (as returned by readUdq). A = "Was", B = "Now". */
function udqDiff(a, b) {
  const ma = a.meta || {}, mb = b.meta || {};
  const meta = [];
  for (const [label, get] of _CMP_META_FIELDS) {
    if (!_cmpEqual(get(ma), get(mb))) meta.push({ field: label, old: _cmpStr(get(ma)), new: _cmpStr(get(mb)) });
  }

  const parties = [];
  const summ = (p) => {
    if (!p) return "";
    return [p.contact, p.phone, p.email, (p.addr_lines || []).join(" / "), p.country].filter(Boolean).join(" · ");
  };
  const pa = a.parties || {}, pb = b.parties || {};
  for (const [label, key] of _CMP_PARTY_KEYS) {
    const sa = summ(pa[key]), sb = summ(pb[key]);
    if (_cmpStr(sa) !== _cmpStr(sb)) parties.push({ field: label, old: sa, new: sb });
  }

  // Inventory: match on Model+Description (strict), then Model, then Description,
  // so an edited model or description reports as a changed field instead of a
  // removed+added pair — and identical rows cancel regardless of order.
  const itemKeys = [
    _cmpItemKey,
    (it) => _cmpStr(it.model).toUpperCase(),
    (it) => _cmpStr(it.desc).toUpperCase(),
  ];
  const { changed, removed, added } =
    _cmpMatch(a.items || [], b.items || [], itemKeys, _CMP_ITEM_FIELDS_FULL, _cmpItemLabel);

  // Packages ("P" rows): match on ship group, then description. When ship groups
  // are blank/duplicated (common — parent pallets often share a generic label),
  // only exact-equal pallets cancel; the rest are honestly reported as
  // added/removed rather than positionally mis-paired into phantom "changes."
  const pkgKeys = [
    (p) => _cmpStr(p.ship_group).toUpperCase(),
    (p) => _cmpStr(p.description).toUpperCase(),
  ];
  const pkg = _cmpMatch(a.packages || [], b.packages || [], pkgKeys, _CMP_PKG_FIELDS, _cmpPkgLabel);

  return {
    meta, parties,
    items: { added, removed, changed },
    packages: { added: pkg.added, removed: pkg.removed, changed: pkg.changed },
    counts: {
      meta: meta.length, parties: parties.length,
      added: added.length, removed: removed.length, changed: changed.length,
      pkg: pkg.added.length + pkg.removed.length + pkg.changed.length,
    },
  };
}

/* ---------------- File parsing (in-memory; never touches AppState) ---------------- */
async function _cmpParseFile(file) {
  try {
    const buf = await file.arrayBuffer();
    const grid = workbookToGrid(buf);
    const type = detectUdqType(grid);
    if (type !== "srf") return { error: `That file looks like a ${type === "unknown" ? "non-UDQ" : type} layout. Compare works on SRF UDQs.` };
    return { type, data: readUdq(grid) };
  } catch (e) {
    return { error: "Couldn't read that file: " + e.message };
  }
}

/* ---------------- ATLAS fetch (in-memory; never touches AppState) ----------------
   Reuses json_udq.js: atlasFetchUdqJson -> atlasFindRecords -> atlasRecordsToGrid,
   then round-trips the grid through atlasGridToXlsxBuffer + workbookToGrid so the
   record is read by the EXACT same path as a loaded file — just without loadFile().
   The combined Shipping UDQ is fetched once per Compare session and cached, so
   pulling both slots from ATLAS costs one network trip. */

let _cmpAtlasRecs = null;   // per-modal-session cache of the combined UDQ records

function _cmpAtlasReady() {
  return typeof atlasFetchUdqJson === "function" &&
         typeof atlasFindRecords === "function" &&
         typeof atlasRecordsToGrid === "function" &&
         typeof atlasGridToXlsxBuffer === "function";
}

function _cmpAtlasRecordToData(rec) {
  const grid = workbookToGrid(atlasGridToXlsxBuffer(atlasRecordsToGrid([rec])));
  const type = detectUdqType(grid);
  if (type !== "srf") throw new Error(`ATLAS returned a ${type} layout for that WMTR — Compare works on SRF UDQs.`);
  return readUdq(grid);
}

async function _cmpFetchAtlas(slotKey, wmtr, ui) {
  const setErr = (m) => { ui.err.textContent = m || ""; };
  setErr(""); ui.pick.innerHTML = "";

  if (!_cmpAtlasReady()) { setErr("ATLAS fetch isn't available (json_udq.js not loaded)."); return; }
  const ids = (typeof atlasIds === "function" ? atlasIds() : {});
  const id = ids.shipping;
  if (!id) { setErr(`No ${ATLAS_UDQ_CONFIG.env.toUpperCase()} Shipping UDQ ID configured. Add it to ATLAS_UDQ_CONFIG.`); return; }
  const q = String(wmtr || "").trim();
  if (!q) { setErr("Enter a WMTR number to fetch."); return; }

  const btnLabel = ui.btn.textContent;
  ui.btn.disabled = true; ui.btn.textContent = "Fetching…";
  try {
    let recs;
    if (ATLAS_UDQ_CONFIG.shippingWmtrParam) {
      // Server-side single-WMTR filter (when wired) — no whole-list cache needed.
      recs = await atlasFetchUdqJson(id, `${encodeURIComponent(ATLAS_UDQ_CONFIG.shippingWmtrParam)}=${encodeURIComponent(q)}`);
    } else {
      if (!_cmpAtlasRecs) _cmpAtlasRecs = await atlasFetchUdqJson(id);
      recs = _cmpAtlasRecs;
    }
    const matches = atlasFindRecords(recs, q);
    if (!matches.length) {
      setErr(`WMTR "${q}" wasn't found in the UDQ (${recs.length} record${recs.length === 1 ? "" : "s"} returned). Check the number, or your ATLAS permissions for that request.`);
      return;
    }
    if (matches.length > 1) {
      // Several WMTRs match — pick one, inside this slot.
      ui.pick.innerHTML = `<div class="cmp-pick-hint">Several WMTRs match — pick one:</div>` +
        matches.map((r) => {
          const g = String(r.GMTRNumber || "");
          const t = String(r.RequestTitle || "");
          return `<button type="button" class="btn ghost cmp-pick-btn" data-wmtr="${esc(g)}">${esc(g)}${t ? " — " + esc(t) : ""}</button>`;
        }).join("");
      ui.pick.querySelectorAll(".cmp-pick-btn").forEach((b) => {
        b.addEventListener("click", () => {
          const g = b.getAttribute("data-wmtr");
          const rec = matches.find((r) => String(r.GMTRNumber || "") === g);
          ui.pick.innerHTML = "";
          if (rec) _cmpApplyAtlasRecord(slotKey, rec, ui);
        });
      });
      return;
    }
    _cmpApplyAtlasRecord(slotKey, matches[0], ui);
  } catch (e) {
    console.error(e);
    setErr(e.message || String(e));
  } finally {
    ui.btn.disabled = false; ui.btn.textContent = btnLabel;
  }
}

function _cmpApplyAtlasRecord(slotKey, rec, ui) {
  try {
    const data = _cmpAtlasRecordToData(rec);
    const g = String(rec.GMTRNumber || "");
    const last5 = (typeof atlasLast5 === "function" ? atlasLast5(g) : "") || g;
    _cmpSetSlot(slotKey, { data, label: `ATLAS — WMTR ${last5}`, source: "atlas" });
  } catch (e) {
    console.error(e);
    ui.err.textContent = e.message || String(e);
  }
}

/* ---------------- Modal ---------------- */
const COMPARE_STYLE = `
  .cmp-overlay{position:fixed;inset:0;background:rgba(12,18,28,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:5vh 16px;overflow:auto;}
  .cmp-dialog{background:var(--card);color:inherit;border:1px solid var(--line);border-radius:12px;max-width:880px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.3);}
  .cmp-dialog header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);}
  .cmp-dialog header h2{margin:0;font-family:var(--disp);}
  .cmp-dialog header .x{margin-left:auto;background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:var(--steel);}
  .cmp-body{padding:14px 18px;max-height:70vh;overflow:auto;}
  .cmp-base{color:var(--steel);font-size:.85rem;}
  .cmp-base b{color:var(--ink);}
  .cmp-err{color:var(--warn);font-size:.85rem;margin-top:6px;min-height:0;}
  .cmp-slots{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start;}
  @media (max-width:640px){.cmp-slots{grid-template-columns:1fr;}}
  .cmp-slot-h{font:600 .8rem var(--disp);letter-spacing:.06em;text-transform:uppercase;color:var(--steel);margin:0 0 4px;}
  .cmp-slot-h .tag{color:var(--accent);}
  .cmp-drop{border:2px dashed #B9C4CE;border-radius:12px;min-height:112px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center;cursor:pointer;padding:12px;transition:border-color .12s ease,background-color .12s ease;}
  .cmp-drop:hover,.cmp-drop.dragover{border-color:var(--accent);background:#FFF7F2;}
  .cmp-drop:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
  .cmp-drop svg{color:var(--accent);margin-bottom:2px;}
  .cmp-drop.filled{border-style:solid;border-color:var(--cleared);}
  .cmp-drop.filled svg{color:var(--cleared);}
  .cmp-drop-title{font-family:var(--disp);font-size:15px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--ink);overflow-wrap:anywhere;}
  .cmp-drop-sub{font-size:11.5px;color:var(--steel);max-width:34ch;}
  .cmp-fetch{display:flex;gap:6px;margin-top:8px;align-items:center;}
  .cmp-fetch input{flex:1;min-width:0;padding:6px 9px;border:1px solid #B9C4CE;border-radius:6px;font-size:12.5px;background:var(--card);color:var(--ink);}
  .cmp-fetch input:focus{outline:2px solid var(--accent);border-color:var(--accent);}
  .cmp-fetch .btn{padding:6px 10px;font-size:12px;white-space:nowrap;}
  .cmp-fetch-lbl{font:600 .68rem var(--disp);letter-spacing:.05em;text-transform:uppercase;color:var(--steel);margin-top:8px;}
  .cmp-pick-hint{color:var(--steel);font-size:.82rem;margin:6px 0 2px;}
  .cmp-pick-btn{display:block;width:100%;text-align:left;margin:4px 0;font-size:12.5px;}
  .cmp-hint{color:var(--steel);font-size:.88rem;margin:14px 0 2px;}
  .cmp-summary{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;}
  .cmp-chip{font:600 .72rem var(--disp);letter-spacing:.04em;text-transform:uppercase;padding:4px 9px;border-radius:20px;border:1px solid var(--line);color:var(--steel);background:transparent;}
  .cmp-chip.add{color:var(--cleared);border-color:var(--cleared);}
  .cmp-chip.rem{color:var(--warn);border-color:var(--warn);}
  .cmp-chip.chg{color:var(--accent);border-color:var(--accent);}
  .cmp-chip.cmp-jump{cursor:pointer;transition:background-color .12s ease,box-shadow .12s ease;}
  .cmp-chip.cmp-jump:hover{background:#F0F4F8;box-shadow:0 1px 4px rgba(20,32,59,.16);}
  .cmp-chip:disabled{opacity:.5;cursor:default;}
  .cmp-sec{margin:16px 0 6px;font:600 .8rem var(--disp);letter-spacing:.05em;text-transform:uppercase;color:var(--steel);border-bottom:1px solid var(--line);padding-bottom:4px;scroll-margin-top:6px;}
  table.cmp-table{width:100%;border-collapse:collapse;font-size:.86rem;}
  table.cmp-table th,table.cmp-table td{text-align:left;padding:6px 9px;border-bottom:1px solid var(--line);vertical-align:top;}
  table.cmp-table th{font:600 .7rem var(--disp);letter-spacing:.04em;text-transform:uppercase;color:var(--steel);}
  .cmp-old{color:var(--warn);text-decoration:line-through;opacity:.8;}
  .cmp-new{color:var(--cleared);}
  .cmp-none{color:var(--steel);font-size:.88rem;padding:6px 0;}
  .cmp-item{margin:8px 0;padding:8px 10px;border:1px solid var(--line);border-radius:8px;}
  .cmp-item .cmp-item-h{font-weight:600;margin-bottom:4px;}
  .cmp-sub{margin:6px 0;scroll-margin-top:6px;}
  .cmp-actions{display:flex;align-items:center;gap:10px;margin:12px 0 2px;}
  @keyframes cmpFlash{0%{box-shadow:0 0 0 3px rgba(232,89,12,0);}30%{box-shadow:0 0 0 3px rgba(232,89,12,.45);}100%{box-shadow:0 0 0 3px rgba(232,89,12,0);}}
  .cmp-flash{animation:cmpFlash 1.1s ease-out;border-radius:6px;}
`;

/* Slot state: { data, label, source: "loaded" | "file" | "atlas" } or null. */
let _cmpSlot = { A: null, B: null };

const _CMP_SOURCE_NOTE = {
  loaded: "currently loaded UDQ",
  file: "dropped file",
  atlas: "fetched from ATLAS",
};

function _cmpSlotHtml(key, tag) {
  return `
    <div class="cmp-slot" data-slot="${key}">
      <div class="cmp-slot-h">UDQ ${key} <span class="tag">${tag}</span></div>
      <div class="cmp-drop" id="cmpDrop${key}" tabindex="0" role="button" aria-label="Drop UDQ ${key} Excel file, or click to browse">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
        <div class="cmp-drop-title">Drop UDQ ${key}</div>
        <div class="cmp-drop-sub">or click to browse (.xlsx)</div>
        <input type="file" accept=".xlsx,.xlsm" style="display:none">
      </div>
      <div class="cmp-fetch-lbl">Or fetch from ATLAS</div>
      <div class="cmp-fetch">
        <input type="text" inputmode="numeric" placeholder="WMTR e.g. 10097" autocomplete="off" aria-label="WMTR number for UDQ ${key}">
        <button class="btn primary" type="button">Fetch</button>
      </div>
      <div class="cmp-pick-list"></div>
      <div class="cmp-err"></div>
    </div>`;
}

function openCompare() {
  closeCompare();
  _cmpSlot = { A: null, B: null };
  _cmpAtlasRecs = null;
  _cmpLastDiff = null;

  const overlay = el(`
    <div class="cmp-overlay" id="cmpOverlay">
      <div class="cmp-dialog" role="dialog" aria-modal="true" aria-label="Compare UDQs">
        <style>${COMPARE_STYLE}</style>
        <header>
          <h2>Compare UDQs</h2>
          <button class="x" id="cmpClose" title="Close" aria-label="Close">×</button>
        </header>
        <div class="cmp-body" id="cmpBody">
          <div class="cmp-slots">
            ${_cmpSlotHtml("A", "was")}
            ${_cmpSlotHtml("B", "now")}
          </div>
          <div class="cmp-hint" id="cmpHint">Load two SRF UDQs — drop a file or fetch by WMTR — and the differences appear below.</div>
          <div class="cmp-actions" id="cmpActions" style="display:none;">
            <button class="btn ghost" id="cmpExport" type="button">Export results (.xlsx)</button>
            <button class="btn ghost" id="cmpExportWord" type="button">Export to Word (.doc)</button>
          </div>
          <div id="cmpResult"></div>
        </div>
      </div>
    </div>`);
  document.body.appendChild(overlay);

  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeCompare(); });
  overlay.querySelector("#cmpClose").addEventListener("click", closeCompare);
  document.addEventListener("keydown", _cmpEscHandler);

  _cmpWireSlot(overlay, "A");
  _cmpWireSlot(overlay, "B");

  // If an SRF UDQ is already loaded, it pre-fills slot A (still replaceable).
  if (typeof AppState !== "undefined" && AppState.udqType === "srf" && AppState.data) {
    _cmpSetSlot("A", {
      data: AppState.data,
      label: _cmpStr(AppState.data.meta && AppState.data.meta.wmtr) || AppState.fileName || "Loaded UDQ",
      source: "loaded",
    });
  }

  const exp = overlay.querySelector("#cmpExport");
  if (exp) exp.addEventListener("click", () => {
    if (_cmpLastDiff) _cmpExportXlsx(_cmpLastDiff, _cmpLastBase, _cmpLastOther);
  });
  const expW = overlay.querySelector("#cmpExportWord");
  if (expW) expW.addEventListener("click", () => {
    if (_cmpLastDiff) _cmpExportWord(_cmpLastDiff, _cmpLastBase, _cmpLastOther);
  });
}

function _cmpSlotEl(key) {
  const o = document.getElementById("cmpOverlay");
  return o ? o.querySelector(`.cmp-slot[data-slot="${key}"]`) : null;
}

/* Drop / browse / ATLAS-fetch wiring for one slot. */
function _cmpWireSlot(overlay, key) {
  const slot = overlay.querySelector(`.cmp-slot[data-slot="${key}"]`);
  const drop = slot.querySelector(".cmp-drop");
  const fileInput = slot.querySelector('input[type="file"]');
  const wmtrInput = slot.querySelector('.cmp-fetch input');
  const fetchBtn = slot.querySelector('.cmp-fetch .btn');
  const ui = { err: slot.querySelector(".cmp-err"), pick: slot.querySelector(".cmp-pick-list"), btn: fetchBtn };

  const browse = () => fileInput.click();
  drop.addEventListener("click", browse);
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); browse(); }
  });
  for (const evt of ["dragover", "dragenter"]) {
    drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.add("dragover"); });
  }
  for (const evt of ["dragleave", "drop"]) {
    drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.remove("dragover"); });
  }
  drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) _cmpHandleFile(key, f, ui);
  });
  fileInput.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";               // allow re-picking the same file
    if (f) _cmpHandleFile(key, f, ui);
  });

  const fire = () => _cmpFetchAtlas(key, wmtrInput.value, ui);
  fetchBtn.addEventListener("click", fire);
  wmtrInput.addEventListener("keydown", (e) => { if (e.key === "Enter") fire(); });
}

/* Parse a dropped/browsed file into the slot (SRF-validated, in-memory only). */
async function _cmpHandleFile(key, f, ui) {
  ui.err.textContent = ""; ui.pick.innerHTML = "";
  const drop = _cmpSlotEl(key).querySelector(".cmp-drop");
  const sub = drop.querySelector(".cmp-drop-sub");
  if (sub) sub.textContent = `Reading ${f.name}…`;
  const parsed = await _cmpParseFile(f);
  if (parsed.error) {
    ui.err.textContent = parsed.error;
    _cmpRenderSlotZone(key);            // restore the zone text
    return;
  }
  _cmpSetSlot(key, { data: parsed.data, label: f.name, source: "file" });
}

/* Store a slot's payload, repaint its zone, and (re)run the diff if both set. */
function _cmpSetSlot(key, payload) {
  _cmpSlot[key] = payload;
  _cmpRenderSlotZone(key);
  const slot = _cmpSlotEl(key);
  if (slot) { slot.querySelector(".cmp-err").textContent = ""; slot.querySelector(".cmp-pick-list").innerHTML = ""; }
  _cmpMaybeRun();
}

function _cmpRenderSlotZone(key) {
  const slot = _cmpSlotEl(key);
  if (!slot) return;
  const drop = slot.querySelector(".cmp-drop");
  const s = _cmpSlot[key];
  const title = drop.querySelector(".cmp-drop-title");
  const sub = drop.querySelector(".cmp-drop-sub");
  if (s) {
    drop.classList.add("filled");
    title.textContent = `✓ ${s.label}`;
    sub.textContent = `${_CMP_SOURCE_NOTE[s.source] || s.source} — drop, browse, or fetch to replace`;
    drop.setAttribute("aria-label", `UDQ ${key}: ${s.label}. Drop, browse, or fetch to replace.`);
  } else {
    drop.classList.remove("filled");
    title.textContent = `Drop UDQ ${key}`;
    sub.textContent = "or click to browse (.xlsx)";
    drop.setAttribute("aria-label", `Drop UDQ ${key} Excel file, or click to browse`);
  }
}

function _cmpMaybeRun() {
  const o = document.getElementById("cmpOverlay");
  if (!o) return;
  const result = o.querySelector("#cmpResult");
  const actions = o.querySelector("#cmpActions");
  const hint = o.querySelector("#cmpHint");
  const A = _cmpSlot.A, B = _cmpSlot.B;
  if (!A || !B) {
    _cmpLastDiff = null;
    result.innerHTML = "";
    actions.style.display = "none";
    hint.style.display = "";
    hint.textContent = (A || B)
      ? `Load UDQ ${A ? "B" : "A"} to run the comparison.`
      : "Load two SRF UDQs — drop a file or fetch by WMTR — and the differences appear below.";
    return;
  }
  hint.style.display = "none";
  _cmpRenderDiff(result, A.data, B.data, A.label, B.label);
  actions.style.display = "";
}

function _cmpFieldTable(rows, col1) {
  return `
    <table class="cmp-table">
      <thead><tr><th>${esc(col1)}</th><th>Was</th><th>Now</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td>${esc(r.field)}</td>
          <td class="cmp-old">${esc(r.old) || "—"}</td>
          <td class="cmp-new">${esc(r.new) || "—"}</td>
        </tr>`).join("")}</tbody>
    </table>`;
}

/* Last rendered diff, kept so the Export buttons can rebuild it. */
let _cmpLastDiff = null, _cmpLastBase = "", _cmpLastOther = "";

function _cmpRenderDiff(host, a, b, labelA, labelB) {
  const d = udqDiff(a, b);
  const c = d.counts;
  _cmpLastDiff = d;
  _cmpLastBase = labelA || "UDQ A";
  _cmpLastOther = labelB || "UDQ B";
  const nothing = !c.meta && !c.parties && !c.added && !c.removed && !c.changed && !c.pkg;

  const chip = (cls, target, count, label) =>
    `<button type="button" class="cmp-chip ${cls} ${count ? "cmp-jump" : ""}" ${count ? `data-target="${target}"` : "disabled"}>${count} ${label}</button>`;

  let html = `
    <div class="cmp-summary">
      ${chip("", "cmpSecMeta", c.meta, `shipment field${c.meta === 1 ? "" : "s"}`)}
      ${chip("", "cmpSecParties", c.parties, `part${c.parties === 1 ? "y" : "ies"}`)}
      ${chip("add", "cmpSecAdded", c.added, "added")}
      ${chip("rem", "cmpSecRemoved", c.removed, "removed")}
      ${chip("chg", "cmpSecChanged", c.changed, "changed")}
      ${chip("", "cmpSecPkg", c.pkg, `package${c.pkg === 1 ? "" : "s"}`)}
    </div>
    <div class="cmp-base" style="margin-bottom:6px;">Was: <b>${esc(labelA)}</b> &nbsp;→&nbsp; Now: <b>${esc(labelB)}</b></div>`;

  if (nothing) { host.innerHTML = html + `<div class="cmp-none">No differences detected between the two UDQs.</div>`; return; }

  if (d.meta.length) html += `<div class="cmp-sec" id="cmpSecMeta">Shipment fields</div>` + _cmpFieldTable(d.meta, "Field");
  if (d.parties.length) html += `<div class="cmp-sec" id="cmpSecParties">Parties</div>` + _cmpFieldTable(d.parties, "Party");

  if (d.items.added.length || d.items.removed.length || d.items.changed.length) {
    html += `<div class="cmp-sec">Inventory</div>`;
    if (d.items.added.length) {
      html += `<div class="cmp-sub" id="cmpSecAdded"><span class="cmp-new">Added (${d.items.added.length}):</span><ul style="margin:4px 0 0;padding-left:18px;">` +
        d.items.added.map((i) => `<li>${esc(i.label)}</li>`).join("") + `</ul></div>`;
    }
    if (d.items.removed.length) {
      html += `<div class="cmp-sub" id="cmpSecRemoved"><span class="cmp-old" style="text-decoration:none;">Removed (${d.items.removed.length}):</span><ul style="margin:4px 0 0;padding-left:18px;">` +
        d.items.removed.map((i) => `<li>${esc(i.label)}</li>`).join("") + `</ul></div>`;
    }
    if (d.items.changed.length) {
      html += `<div id="cmpSecChanged">`;
      d.items.changed.forEach((it) => {
        html += `<div class="cmp-item"><div class="cmp-item-h">${esc(it.label)}</div>` +
          `<table class="cmp-table"><tbody>` +
          it.changes.map((ch) => `<tr><td>${esc(ch.field)}</td><td class="cmp-old">${esc(ch.old) || "—"}</td><td class="cmp-new">${esc(ch.new) || "—"}</td></tr>`).join("") +
          `</tbody></table></div>`;
      });
      html += `</div>`;
    }
  }

  if (d.packages.added.length || d.packages.removed.length || d.packages.changed.length) {
    html += `<div class="cmp-sec" id="cmpSecPkg">Packages</div>`;
    if (d.packages.added.length) {
      html += `<div class="cmp-sub"><span class="cmp-new">Added (${d.packages.added.length}):</span><ul style="margin:4px 0 0;padding-left:18px;">` +
        d.packages.added.map((i) => `<li>${esc(i.label)}</li>`).join("") + `</ul></div>`;
    }
    if (d.packages.removed.length) {
      html += `<div class="cmp-sub"><span class="cmp-old" style="text-decoration:none;">Removed (${d.packages.removed.length}):</span><ul style="margin:4px 0 0;padding-left:18px;">` +
        d.packages.removed.map((i) => `<li>${esc(i.label)}</li>`).join("") + `</ul></div>`;
    }
    d.packages.changed.forEach((it) => {
      html += `<div class="cmp-item"><div class="cmp-item-h">${esc(it.label)}</div>` +
        `<table class="cmp-table"><tbody>` +
        it.changes.map((ch) => `<tr><td>${esc(ch.field)}</td><td class="cmp-old">${esc(ch.old) || "—"}</td><td class="cmp-new">${esc(ch.new) || "—"}</td></tr>`).join("") +
        `</tbody></table></div>`;
    });
  }
  host.innerHTML = html;

  // Summary chips jump to (and briefly flash) the top of their section.
  host.querySelectorAll(".cmp-chip.cmp-jump").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.getAttribute("data-target"));
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.remove("cmp-flash");
      void target.offsetWidth;             // restart the flash animation
      target.classList.add("cmp-flash");
    });
  });
}

/* Preferred WMTR last-5 for export file names: slot A, then B, then fallback. */
function _cmpExportLast5() {
  const pick = (s) => s && s.data && s.data.meta && s.data.meta.wmtr_last5;
  return pick(_cmpSlot.A) || pick(_cmpSlot.B) || "UDQ";
}

/* Export the current diff as a single-sheet .xlsx (sections stacked). */
function _cmpExportXlsx(d, labelA, labelB) {
  try {
    const aoa = [];
    aoa.push(["UDQ Comparison"]);
    aoa.push(["UDQ A (Was)", labelA]);
    aoa.push(["UDQ B (Now)", labelB]);
    aoa.push(["Generated", new Date().toLocaleString()]);
    aoa.push([]);
    if (d.meta.length) {
      aoa.push(["Shipment fields", "Was", "Now"]);
      d.meta.forEach((r) => aoa.push([r.field, r.old, r.new]));
      aoa.push([]);
    }
    if (d.parties.length) {
      aoa.push(["Parties", "Was", "Now"]);
      d.parties.forEach((r) => aoa.push([r.field, r.old, r.new]));
      aoa.push([]);
    }
    if (d.items.added.length) {
      aoa.push(["Inventory — Added"]);
      d.items.added.forEach((i) => aoa.push([i.label]));
      aoa.push([]);
    }
    if (d.items.removed.length) {
      aoa.push(["Inventory — Removed"]);
      d.items.removed.forEach((i) => aoa.push([i.label]));
      aoa.push([]);
    }
    if (d.items.changed.length) {
      aoa.push(["Inventory — Changed", "Field", "Was", "Now"]);
      d.items.changed.forEach((it) => {
        it.changes.forEach((ch, idx) => aoa.push([idx === 0 ? it.label : "", ch.field, ch.old, ch.new]));
      });
      aoa.push([]);
    }
    if (d.packages.added.length) {
      aoa.push(["Packages — Added"]);
      d.packages.added.forEach((i) => aoa.push([i.label]));
      aoa.push([]);
    }
    if (d.packages.removed.length) {
      aoa.push(["Packages — Removed"]);
      d.packages.removed.forEach((i) => aoa.push([i.label]));
      aoa.push([]);
    }
    if (d.packages.changed.length) {
      aoa.push(["Packages — Changed", "Field", "Was", "Now"]);
      d.packages.changed.forEach((it) => {
        it.changes.forEach((ch, idx) => aoa.push([idx === 0 ? it.label : "", ch.field, ch.old, ch.new]));
      });
      aoa.push([]);
    }
    if (aoa.length <= 5) aoa.push(["No differences detected."]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 28 }, { wch: 30 }, { wch: 30 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Comparison");
    const b64 = XLSX.write(wb, { bookType: "xlsx", type: "base64" });

    const fname = `UDQ_Compare_${_cmpExportLast5()}_${fileStamp()}.xlsx`;
    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + b64;
    a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => document.body.removeChild(a), 1000);
  } catch (e) {
    console.error(e);
    alert("Couldn't export the comparison: " + (e.message || e));
  }
}

/* Build a Word-compatible HTML document that mirrors the on-screen compare view
   (same section layout, red struck-through "Was", green "Now", summary chips).
   Saved as .doc — Word opens it and keeps the colors/strikethrough/tables. */
function _cmpBuildWordHtml(d, labelA, labelB) {
  const c = d.counts;
  const cell = (v) => (esc(v) || "&mdash;");
  const fieldTable = (rows, col1) =>
    `<table class=diff><thead><tr><th>${esc(col1)}</th><th>Was</th><th>Now</th></tr></thead><tbody>` +
    rows.map((r) => `<tr><td>${esc(r.field)}</td><td class=old>${cell(r.old)}</td><td class=new>${cell(r.new)}</td></tr>`).join("") +
    `</tbody></table>`;
  const changedBlocks = (list) => list.map((it) =>
    `<div class=item><p class=item-h>${esc(it.label)}</p>` +
    `<table class=diff><tbody>` +
    it.changes.map((ch) => `<tr><td>${esc(ch.field)}</td><td class=old>${cell(ch.old)}</td><td class=new>${cell(ch.new)}</td></tr>`).join("") +
    `</tbody></table></div>`).join("");

  let body = "";
  const nothing = !c.meta && !c.parties && !c.added && !c.removed && !c.changed && !c.pkg;

  if (d.meta.length) body += `<p class=sec>Shipment fields</p>` + fieldTable(d.meta, "Field");
  if (d.parties.length) body += `<p class=sec>Parties</p>` + fieldTable(d.parties, "Party");

  if (d.items.added.length || d.items.removed.length || d.items.changed.length) {
    body += `<p class=sec>Inventory</p>`;
    if (d.items.added.length) {
      body += `<p class=subhead><span class=new>Added (${d.items.added.length}):</span></p>` +
        `<ul class=plain>` + d.items.added.map((i) => `<li class=additem>${esc(i.label)}</li>`).join("") + `</ul>`;
    }
    if (d.items.removed.length) {
      body += `<p class=subhead><span class=remitem>Removed (${d.items.removed.length}):</span></p>` +
        `<ul class=plain>` + d.items.removed.map((i) => `<li class=remitem>${esc(i.label)}</li>`).join("") + `</ul>`;
    }
    body += changedBlocks(d.items.changed);
  }

  if (d.packages.added.length || d.packages.removed.length || d.packages.changed.length) {
    body += `<p class=sec>Packages</p>`;
    if (d.packages.added.length) {
      body += `<p class=subhead><span class=new>Added (${d.packages.added.length}):</span></p>` +
        `<ul class=plain>` + d.packages.added.map((i) => `<li class=additem>${esc(i.label)}</li>`).join("") + `</ul>`;
    }
    if (d.packages.removed.length) {
      body += `<p class=subhead><span class=remitem>Removed (${d.packages.removed.length}):</span></p>` +
        `<ul class=plain>` + d.packages.removed.map((i) => `<li class=remitem>${esc(i.label)}</li>`).join("") + `</ul>`;
    }
    body += changedBlocks(d.packages.changed);
  }
  if (nothing) body = `<p class=none>No differences detected between the two UDQs.</p>`;

  const chips =
    `<span class=chip>${c.meta} shipment field${c.meta === 1 ? "" : "s"}</span>` +
    `<span class=chip>${c.parties} part${c.parties === 1 ? "y" : "ies"}</span>` +
    `<span class="chip add">${c.added} added</span>` +
    `<span class="chip rem">${c.removed} removed</span>` +
    `<span class="chip chg">${c.changed} changed</span>` +
    `<span class=chip>${c.pkg} package${c.pkg === 1 ? "" : "s"}</span>`;

  return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'>
<head>
<meta charset="utf-8">
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>
@page Section1 { size:8.5in 11.0in; margin:0.8in 0.8in 0.9in 0.8in; }
div.Section1 { page:Section1; }
body,p,td,th,div,li,span { font-family:Arial,Helvetica,sans-serif; font-size:10.5pt; color:#16283C; line-height:1.25; }
h1 { font-size:16pt; letter-spacing:1pt; text-transform:uppercase; margin:0 0 6pt 0; color:#16283C; }
.meta { color:#5B6B7C; font-size:9pt; margin:0 0 2pt 0; }
.meta b { color:#16283C; }
.summary { margin:12pt 0 4pt 0; }
.chip { border:1px solid #D4DAE0; padding:2pt 8pt; margin-right:6pt; font-size:8.5pt; letter-spacing:.4pt; text-transform:uppercase; color:#5B6B7C; }
.chip.add { color:#1E7F4F; border-color:#1E7F4F; }
.chip.rem { color:#B00000; border-color:#B00000; }
.chip.chg { color:#E8590C; border-color:#E8590C; }
.sec { font-size:11pt; font-weight:bold; letter-spacing:.6pt; text-transform:uppercase; color:#5B6B7C; border-bottom:1px solid #D4DAE0; padding-bottom:3pt; margin:16pt 0 6pt 0; }
.subhead { margin:6pt 0 2pt 0; }
table.diff { border-collapse:collapse; width:100%; font-size:10pt; margin:2pt 0 6pt 0; }
table.diff th, table.diff td { text-align:left; padding:4pt 7pt; border-bottom:1px solid #D4DAE0; vertical-align:top; }
table.diff th { font-size:8.5pt; letter-spacing:.4pt; text-transform:uppercase; color:#5B6B7C; }
.old { color:#B00000; text-decoration:line-through; }
.new { color:#1E7F4F; }
.additem { color:#1E7F4F; }
.remitem { color:#B00000; }
ul.plain { margin:2pt 0 6pt 0; padding-left:20pt; }
.item { border:1px solid #D4DAE0; padding:6pt 9pt; margin:6pt 0; }
.item-h { font-weight:bold; margin:0 0 3pt 0; }
.none { color:#5B6B7C; }
</style>
</head>
<body><div class=Section1>
  <h1>UDQ Comparison</h1>
  <p class=meta>UDQ A (Was): <b>${esc(labelA)}</b></p>
  <p class=meta>UDQ B (Now): <b>${esc(labelB)}</b></p>
  <p class=meta>Generated: ${esc(new Date().toLocaleString())}</p>
  <div class=summary>${chips}</div>
  ${body}
</div></body></html>`;
}

/* Export the current diff as a Word (.doc) file styled like the utility view. */
function _cmpExportWord(d, labelA, labelB) {
  try {
    const html = _cmpBuildWordHtml(d, labelA, labelB);
    const blob = new Blob(["\ufeff" + html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `UDQ_Compare_${_cmpExportLast5()}_${fileStamp()}.doc`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (e) {
    console.error(e);
    alert("Couldn't export the comparison to Word: " + (e.message || e));
  }
}

function closeCompare() {
  const o = document.getElementById("cmpOverlay");
  if (o) o.remove();
  document.removeEventListener("keydown", _cmpEscHandler);
  _cmpSlot = { A: null, B: null };
  _cmpAtlasRecs = null;       // drop the per-session ATLAS records cache
  _cmpLastDiff = null;
}
function _cmpEscHandler(e) { if (e.key === "Escape") closeCompare(); }

function initCompareButton() {
  const b = document.getElementById("compareBtn");
  if (b) b.addEventListener("click", openCompare);
}
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initCompareButton);
}

/* Node/Jest export hook (browser ignores this) for offline diff-logic testing. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { udqDiff, _cmpEqual, _cmpItemKey, _cmpPkgKey };
}
