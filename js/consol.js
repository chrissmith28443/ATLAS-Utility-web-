/* =========================================================================
   ATLAS Utility Web — consol.js
   WMTR Consolidation.

   Lets a user consolidate several SRF UDQs (WMTRs) into ONE combined shipment:
     • one PRIMARY WMTR — used everywhere the WMTR number is listed / names files;
     • one or more SECONDARY WMTRs — their inventory is merged in, and their WMTR
       numbers are recorded on the documents (e.g. CI Shipment Comments).

   How it plugs in (no changes to the per-document tools required):
     - A secondary UDQ is parsed by the EXACT same path as a loaded file
       (workbookToGrid → detectUdqType → readUdq), mirroring compare.js.
     - consolApplyGlobal() runs FIRST in renderAll(). When consolidation is
       active it builds a COMBINED data model (primary meta/parties + all items +
       all packages + summed totals) and points AppState.dataBase at it, so the
       existing manual-parent / manual-detail overrides and every document tool
       read the combined shipment automatically.
     - The primary's pristine parse is preserved in AppState.consolPrimaryBase so
       turning consolidation off restores the single-WMTR view exactly.

   State (AppState.consol):
     { enabled: bool,
       secondaries: [ { wmtr, last5, data, fileName, source } ] }
   ========================================================================= */

/* ---------------- State helpers ---------------- */

function consolState() {
  if (typeof AppState === "undefined") return null;
  return AppState.consol;
}

/** Consolidation is "active" only when enabled AND at least one secondary is
 *  loaded AND the current dataset is an SRF UDQ. */
function consolActive() {
  if (typeof AppState === "undefined" || AppState.udqType !== "srf") return false;
  const c = AppState.consol;
  return !!(c && c.enabled && c.secondaries && c.secondaries.length);
}

/** Reset consolidation (called on every new file load). */
function consolReset() {
  if (typeof AppState === "undefined") return;
  AppState.consol = null;
  AppState.consolPrimaryBase = null;
}

/** Full secondary WMTR strings (e.g. "WMTR-26-1-B-ET-10310-SRF"). */
function consolSecondaryWmtrs() {
  const c = consolState();
  if (!c || !c.secondaries) return [];
  return c.secondaries
    .map((s) => (s.data && s.data.meta && s.data.meta.wmtr) || s.wmtr || "")
    .filter(Boolean);
}

/** Secondary WMTRs by last-5 (e.g. "10310"). */
function consolSecondaryLast5() {
  const c = consolState();
  if (!c || !c.secondaries) return [];
  return c.secondaries.map((s) => s.last5 || "").filter(Boolean);
}

/* ---------------- Combine engine ---------------- */

/** Build a combined data model from the pristine primary + secondaries.
 *  Never mutates the source objects. Returns `primary` unchanged when there are
 *  no usable secondaries. */
function consolBuildCombined(primary, secondaries) {
  const secs = (secondaries || []).filter((s) => s && s.data);
  if (!primary || !secs.length) return primary;

  // Concatenate inventory + packages (fresh arrays; sources are never mutated).
  // Each item is tagged with the WMTR (last-5) it came from so downstream views —
  // e.g. the ship-group / split panel — can show which request a line belongs to.
  const _l5 = (data, wmtr) =>
    (data && data.meta && data.meta.wmtr_last5) ||
    (typeof wmtrLast5 === "function" ? wmtrLast5((data && data.meta && data.meta.wmtr) || wmtr) : "") || "";
  const primLast5 = _l5(primary);
  let items = (primary.items || []).map((it) => Object.assign({}, it, { __src_wmtr: primLast5 }));
  let packages = (primary.packages || []).slice();
  for (const s of secs) {
    const l5 = s.last5 || _l5(s.data, s.wmtr);
    items = items.concat((s.data.items || []).map((it) => Object.assign({}, it, { __src_wmtr: l5 })));
    packages = packages.concat(s.data.packages || []);
  }
  // Re-sequence line numbers across the combined inventory — each source WMTR
  // starts its own 1..N, so without this the merged list has duplicate line #s.
  // Cloning here also keeps the source items untouched (and preserves __src_wmtr).
  items = items.map((it, i) => Object.assign({}, it, { line: String(i + 1) }));

  // Sum the ATLAS-calculated raw totals across primary + every secondary. Totals
  // in this app are read from the UDQ (not recomputed), so summing per-WMTR
  // totals_raw is the faithful roll-up.
  const acc = {
    pkg_count: 0, udq_lbs: 0, udq_kg: 0, udq_ft3: 0, udq_m3: 0,
    pkg_lbs: 0, pkg_ft3: 0, value_usd: 0,
  };
  const addRaw = (r) => {
    if (!r) return;
    for (const k of Object.keys(acc)) acc[k] += Number(r[k]) || 0;
  };
  addRaw(primary.meta && primary.meta.totals_raw);
  secs.forEach((s) => addRaw(s.data.meta && s.data.meta.totals_raw));

  // Combined "Value of Cargo (USD)" — sum each WMTR's header value so the
  // pre-flight value check reconciles against the COMBINED total, not just the
  // primary's. toFloat tolerates "$" and commas; blanks contribute 0.
  const _cargoNum = (v) => (typeof toFloat === "function")
    ? toFloat(v) : (parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")) || 0);
  let cargoSum = _cargoNum(primary.meta && primary.meta.value_of_cargo);
  secs.forEach((s) => { cargoSum += _cargoNum(s.data.meta && s.data.meta.value_of_cargo); });

  const secWmtrs = secs
    .map((s) => (s.data.meta && s.data.meta.wmtr) || s.wmtr || "")
    .filter(Boolean);
  const secLast5 = secs.map((s) => s.last5 || "").filter(Boolean);

  const baseRaw = (primary.meta && primary.meta.totals_raw) || {};
  const meta = Object.assign({}, primary.meta, {
    total_pkgs: acc.pkg_count ? String(acc.pkg_count) : ((primary.meta && primary.meta.total_pkgs) || ""),
    total_weight: fmtWeight(acc.udq_lbs, acc.udq_kg),
    total_volume: fmtVolume(acc.udq_ft3, acc.udq_m3),
    total_value: fmtMoney(acc.value_usd),
    value_of_cargo: cargoSum ? fmtMoney(cargoSum) : ((primary.meta && primary.meta.value_of_cargo) || ""),
    totals_raw: Object.assign({}, baseRaw, acc),
    _consolidated: true,
    _consol_secondaries: secWmtrs,
    _consol_secondaries_last5: secLast5,
  });

  // meta/parties/wmtr all stay the PRIMARY's — the primary WMTR is the reference
  // and naming WMTR everywhere. Only inventory + totals are combined.
  return Object.assign({}, primary, { meta, items, packages });
}

/** Point AppState.dataBase at the combined model when consolidation is active,
 *  or restore the pristine primary when it is not. Runs FIRST in renderAll(), so
 *  the manual-parent / manual-detail overrides and all tools layer on top of the
 *  combined shipment. */
function consolApplyGlobal() {
  if (typeof AppState === "undefined" || AppState.udqType !== "srf") return;

  const db = AppState.dataBase;
  // Capture the pristine primary whenever dataBase is NOT a combined view and
  // NOT a line-item-split view (those layer on top and must not be mistaken for
  // the pristine primary).
  if (db && !(db.meta && (db.meta._consolidated || db.meta._itemSplit))) AppState.consolPrimaryBase = db;
  const primary = AppState.consolPrimaryBase || db || AppState.data;
  if (!primary) return;

  if (!consolActive()) {
    // If we previously swapped in a combined base, restore the single-WMTR view.
    if (db && db.meta && db.meta._consolidated) {
      AppState.dataBase = primary;
      AppState.data = primary;
    }
    return;
  }

  const combined = consolBuildCombined(primary, AppState.consol.secondaries);
  AppState.dataBase = combined;
  AppState.data = combined;
}

/* ---------------- Address verification ---------------- */

/** Normalized signature of a party's address for equality checks. */
function _consolPartySig(p) {
  if (!p) return "";
  const lines = (p.addr_lines || []).join(" | ");
  return [lines, p.city, p.country]
    .join(" | ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Parties compared across consolidated WMTRs. Destination = deliver. */
const CONSOL_ADDR_PARTIES = [
  { key: "deliver", label: "Destination" },
  { key: "consignee", label: "Ultimate Consignee" },
  { key: "end_user", label: "End User" },
];

/** Compare destination / consignee / end-user of every secondary against the
 *  primary. Returns an array of { wmtr, label } mismatches (empty = all match). */
function consolCheckAddresses(primary, secondaries) {
  const out = [];
  if (!primary) return out;
  const pp = primary.parties || {};
  for (const s of secondaries || []) {
    if (!s || !s.data) continue;
    const sp = s.data.parties || {};
    for (const def of CONSOL_ADDR_PARTIES) {
      const a = _consolPartySig(pp[def.key]);
      const b = _consolPartySig(sp[def.key]);
      // Only flag when BOTH sides carry an address and they differ. A blank on
      // one side is treated as "nothing to contradict", not a mismatch.
      if (a && b && a !== b) {
        out.push({ wmtr: s.last5 || s.wmtr || "", label: def.label });
      }
    }
  }
  return out;
}

/* ---------------- Ship-group collision detection ----------------
   ATLAS ship-group numbers are only unique WITHIN a request. When several WMTRs
   are consolidated, two different requests can each use e.g. group "1" for
   unrelated parents. If the user chooses to keep ATLAS ship groups, those would
   cross-associate on the Packing List. We detect any group value that appears in
   more than one WMTR so the dialog can warn. */
function consolShipGroupCollisions(primary, secondaries) {
  const map = {}; // lowercased group -> { display, wmtrs: [] }
  const scan = (label, data) => {
    if (!data) return;
    const seen = new Set();
    const add = (v) => {
      const raw = String(v == null ? "" : v).trim();
      if (!raw) return;
      const key = raw.toLowerCase();
      if (seen.has(key)) return;        // count each group once per WMTR
      seen.add(key);
      if (!map[key]) map[key] = { display: raw, wmtrs: [] };
      map[key].wmtrs.push(label);
    };
    (data.packages || []).forEach((p) => add(p.ship_group));
    (data.items || []).forEach((it) => add(it.ship_group));
  };
  if (primary) scan((primary.meta && primary.meta.wmtr_last5) || "primary", primary);
  for (const s of secondaries || []) if (s && s.data) scan(s.last5 || s.wmtr || "?", s.data);

  return Object.keys(map)
    .filter((k) => map[k].wmtrs.length > 1)
    .map((k) => ({ group: map[k].display, wmtrs: map[k].wmtrs }));
}

/* ---------------- ATLAS consolidation-link verification ----------------
   The primary UDQ carries ATLAS's "Linked Request List". Each secondary WMTR
   being consolidated should appear there with a linkage type of "consol". If a
   secondary isn't linked, or is linked but NOT as a consolidation, ATLAS doesn't
   know these requests ship together — the user must fix the linkage in ATLAS. */
function _consolLinkKey(v) {
  const l5 = (typeof wmtrLast5 === "function" ? wmtrLast5(v) : "") || "";
  return l5 || String(v == null ? "" : v).trim().toLowerCase();
}

function consolLinkageIssues(primary, secondaries) {
  let links = [];
  try {
    if (typeof readLinkedRequests === "function" && typeof AppState !== "undefined" && AppState.grid) {
      links = readLinkedRequests(AppState.grid) || [];
    }
  } catch (e) { links = []; }

  const consolKeys = new Set();
  const anyKeys = new Set();
  for (const l of links) {
    const k = _consolLinkKey(l.request_number);
    if (!k) continue;
    anyKeys.add(k);
    if (String(l.linkage_type || "").trim().toLowerCase() === "consol") consolKeys.add(k);
  }

  const out = [];
  for (const s of secondaries || []) {
    if (!s) continue;
    const key = _consolLinkKey(s.wmtr || s.last5);
    const disp = s.last5 || s.wmtr || key;
    let status;
    if (consolKeys.has(key)) status = "consol";                 // good — nothing to flag
    else if (anyKeys.has(key)) status = "linked-not-consol";    // linked, but wrong type
    else status = "not-linked";                                 // not linked in ATLAS at all
    if (status !== "consol") out.push({ wmtr: disp, status, hadList: links.length > 0 });
  }
  return out;
}

/* ---------------- Packing List: prefill manual parent items ----------------
   In a consolidation the parent ("P") rows come from several WMTRs, so the
   automatic Ship-Group grouping can't be relied on (groups from different WMTRs
   collide). The Packing List path is therefore the manual parent-item builder:
   we pull EVERY consolidated WMTR's parent items in as manual rows (description,
   dimensions, per-package weight, count) for the user to review. Ship groups are
   left BLANK by default — assigning them to associate items is optional (the
   manual-parent window already has a Ship-group column). If the user leaves them
   blank, the PL follows the usual manual-parent rule: each parent is listed and
   the combined inventory is listed once, unassociated. */

/** Convert one package (parent "P" row) into a manual-parent builder row. */
function _consolPkgToManualRow(pkg, keepGroups) {
  const dims = (typeof parseDimsIn === "function") ? parseDimsIn(pkg.dims || "") : [0, 0, 0];
  const L = dims[0], W = dims[1], H = dims[2];
  let weight = "", weightUnit = "lbs";
  const lbs = String(pkg.weight_lbs == null ? "" : pkg.weight_lbs).replace(/[^0-9.\-]/g, "");
  if (lbs && parseFloat(lbs)) {
    weight = lbs; weightUnit = "lbs";
  } else {
    const kg = String(pkg.weight_kg == null ? "" : pkg.weight_kg).replace(/[^0-9.\-]/g, "");
    if (kg && parseFloat(kg)) { weight = kg; weightUnit = "kg"; }
  }
  const row = (typeof mpBlankRow === "function") ? mpBlankRow()
    : { description: "", L: "", W: "", H: "", dimUnit: "in", weight: "", weightUnit: "lbs", count: 1, ship_group: "" };
  row.description = pkg.description || "";
  row.L = L || ""; row.W = W || ""; row.H = H || ""; row.dimUnit = "in";
  row.weight = weight; row.weightUnit = weightUnit;
  row.count = Math.max(1, Math.trunc(Number(pkg.count) || 1));
  row.ship_group = keepGroups ? (pkg.ship_group || "") : "";
  return row;
}

/** Build manual parent rows from every consolidated WMTR's parent items and
 *  enable the manual-parent override so the Packing List (and other parent-aware
 *  documents) use them. Returns { count } or { error }. */
function consolPrefillManualParents(opts) {
  const primary = _consolPrimary();
  if (!primary) return { error: "Load a primary Shipping (SRF) UDQ first." };
  const secs = (AppState.consol && AppState.consol.secondaries) || [];
  const combined = consolBuildCombined(primary, secs);
  const pkgs = (combined && combined.packages) || [];
  if (!pkgs.length) return { error: "None of the consolidated WMTRs carry parent (“P”) rows to prefill." };

  const keepGroups = !!(opts && opts.keepGroups);
  const rows = pkgs.map((p) => _consolPkgToManualRow(p, keepGroups));

  AppState.manualParents = {
    enabled: true,
    items: rows.length ? rows : [(typeof mpBlankRow === "function" ? mpBlankRow() : {})],
    perTool: {},
    _consolPrefill: true,
  };
  if (typeof mpPersistCurrent === "function") mpPersistCurrent();
  if (typeof mpApplyAndRefresh === "function") mpApplyAndRefresh();
  return { ok: true, count: rows.length };
}

/* ---------------- Secondary loading (mirrors compare.js) ---------------- */

async function _consolParseFile(file) {
  try {
    const buf = await file.arrayBuffer();
    const grid = workbookToGrid(buf);
    const type = detectUdqType(grid);
    if (type !== "srf") {
      return { error: `That file looks like a ${type === "unknown" ? "non-UDQ" : type} layout. Consolidation works on SRF UDQs.` };
    }
    return { data: readUdq(grid), fileName: file.name, grid };
  } catch (e) {
    return { error: "Couldn't read that file: " + e.message };
  }
}

function _consolAtlasReady() {
  return typeof atlasFetchUdqJson === "function" &&
         typeof atlasFindRecords === "function" &&
         typeof atlasRecordsToGrid === "function" &&
         typeof atlasGridToXlsxBuffer === "function";
}

function _consolAtlasRecordToData(rec) {
  const grid = workbookToGrid(atlasGridToXlsxBuffer(atlasRecordsToGrid([rec])));
  const type = detectUdqType(grid);
  if (type !== "srf") throw new Error(`ATLAS returned a ${type} layout for that WMTR — consolidation works on SRF UDQs.`);
  return { data: readUdq(grid), grid };
}

let _consolAtlasRecs = null;   // per-dialog cache of the combined Shipping UDQ

/** Fetch a secondary WMTR from ATLAS. On success calls onData(data, gmtrNumber);
 *  on multiple matches renders a picker into ui.pick; errors go to ui.err. */
async function _consolFetchAtlas(wmtr, ui, onData) {
  const setErr = (m) => { if (ui.err) ui.err.textContent = m || ""; };
  setErr(""); if (ui.pick) ui.pick.innerHTML = "";

  if (!_consolAtlasReady()) { setErr("ATLAS fetch isn't available (json_udq.js not loaded)."); return; }
  const ids = (typeof atlasIds === "function" ? atlasIds() : {});
  const id = ids.shipping;
  if (!id) { setErr(`No Shipping UDQ ID configured. Add it to ATLAS_UDQ_CONFIG.`); return; }
  const q = String(wmtr || "").trim();
  if (!q) { setErr("Enter a WMTR number to fetch."); return; }

  const btnLabel = ui.btn ? ui.btn.textContent : "";
  if (ui.btn) { ui.btn.disabled = true; ui.btn.textContent = "Fetching…"; }
  try {
    let recs;
    if (typeof ATLAS_UDQ_CONFIG !== "undefined" && ATLAS_UDQ_CONFIG.shippingWmtrParam) {
      recs = await atlasFetchUdqJson(id, `${encodeURIComponent(ATLAS_UDQ_CONFIG.shippingWmtrParam)}=${encodeURIComponent(q)}`);
    } else {
      if (!_consolAtlasRecs) _consolAtlasRecs = await atlasFetchUdqJson(id);
      recs = _consolAtlasRecs;
    }
    const matches = atlasFindRecords(recs, q);
    if (!matches.length) {
      setErr(`WMTR "${q}" wasn't found (${recs.length} record${recs.length === 1 ? "" : "s"} returned). Check the number or your ATLAS permissions.`);
      return;
    }
    if (matches.length > 1) {
      ui.pick.innerHTML = `<div class="consol-pick-hint">Several WMTRs match — pick one:</div>` +
        matches.map((r) => {
          const g = String(r.GMTRNumber || "");
          const t = String(r.RequestTitle || "");
          return `<button type="button" class="btn ghost consol-pick-btn" data-wmtr="${esc(g)}">${esc(g)}${t ? " — " + esc(t) : ""}</button>`;
        }).join("");
      ui.pick.querySelectorAll(".consol-pick-btn").forEach((b) => {
        b.addEventListener("click", () => {
          const g = b.getAttribute("data-wmtr");
          const rec = matches.find((r) => String(r.GMTRNumber || "") === g);
          ui.pick.innerHTML = "";
          if (rec) {
            try { onData(_consolAtlasRecordToData(rec), g); }
            catch (e) { setErr(e.message || String(e)); }
          }
        });
      });
      return;
    }
    const rec = matches[0];
    onData(_consolAtlasRecordToData(rec), String(rec.GMTRNumber || ""));
  } catch (e) {
    console.error(e);
    setErr(e.message || String(e));
  } finally {
    if (ui.btn) { ui.btn.disabled = false; ui.btn.textContent = btnLabel; }
  }
}

/* ---------------- Add / remove secondaries ---------------- */

function _consolEnsureState() {
  if (!AppState.consol) AppState.consol = { enabled: true, secondaries: [] };
  if (!Array.isArray(AppState.consol.secondaries)) AppState.consol.secondaries = [];
  return AppState.consol;
}

/** The primary (pristine) data, if an SRF is loaded. */
function _consolPrimary() {
  if (typeof AppState === "undefined" || AppState.udqType !== "srf") return null;
  return AppState.consolPrimaryBase || AppState.dataBase || AppState.data || null;
}

/** Add a parsed secondary. Returns { error } on duplicate / self. */
function consolAddSecondary(data, source, fileName) {
  const primary = _consolPrimary();
  if (!primary) return { error: "Load a primary Shipping (SRF) UDQ first." };
  const wmtr = (data.meta && data.meta.wmtr) || "";
  const last5 = (data.meta && data.meta.wmtr_last5) ||
    (typeof wmtrLast5 === "function" ? wmtrLast5(wmtr) : "") || "";

  const primW = (primary.meta && primary.meta.wmtr) || "";
  if (wmtr && primW && wmtr === primW) {
    return { error: "That's the primary WMTR — pick a different one to consolidate." };
  }
  const st = _consolEnsureState();
  if (st.secondaries.some((s) => (s.data.meta && s.data.meta.wmtr) === wmtr && wmtr)) {
    return { error: `WMTR ${last5 || wmtr} is already added.` };
  }
  st.secondaries.push({ wmtr, last5, data, fileName: fileName || "", source: source || "file" });
  return { ok: true, last5, wmtr };
}

function consolRemoveSecondary(wmtr) {
  const c = consolState();
  if (!c || !c.secondaries) return;
  c.secondaries = c.secondaries.filter(
    (s) => ((s.data.meta && s.data.meta.wmtr) || s.wmtr) !== wmtr);
}

/* ---------------- Load as primary / add UDQ (window is a self-contained loader) ---------------- */

/** Load a parsed UDQ as the app's PRIMARY shipment (as if it were dropped in). */
function _consolLoadPrimary(data, grid, fileName, source) {
  AppState.fileName = fileName || ((data.meta && data.meta.wmtr_last5) ? ("WMTR " + data.meta.wmtr_last5) : "UDQ");
  AppState.grid = grid || null;
  AppState.udqType = "srf";
  AppState.data = data;
  AppState.dataBase = data;
  AppState.activeTool = null;
  AppState.manualParents = null;
  AppState.itemSplits = null;
  AppState.siBase = null;
  AppState.consol = { enabled: false, secondaries: [] };
  AppState.consolPrimaryBase = data;
  if (typeof mpOnSrfLoaded === "function") mpOnSrfLoaded();
  if (typeof mdOnSrfLoaded === "function") mdOnSrfLoaded();
  if (typeof siOnSrfLoaded === "function") siOnSrfLoaded();
  if (typeof recentsRecordFromState === "function") recentsRecordFromState();
  const status = document.getElementById("loadStatus");
  if (status) {
    status.classList.remove("err");
    status.textContent = `Loaded ${AppState.fileName} — SRF UDQ \u00b7 ${(data.items || []).length} line items \u00b7 ${(data.meta && data.meta.total_pkgs) || 0} packages`;
  }
  if (typeof renderAll === "function") renderAll();
}

/** Add a UDQ from the window: the first one becomes the primary, the rest are
 *  secondaries. Returns { role } or { error }. */
function _consolAddUdq(data, grid, fileName, source) {
  const havePrimary = (typeof AppState !== "undefined") && AppState.udqType === "srf" &&
    (AppState.consolPrimaryBase || AppState.dataBase);
  if (!havePrimary) {
    _consolLoadPrimary(data, grid, fileName, source);
    return { ok: true, role: "primary" };
  }
  const res = consolAddSecondary(data, source, fileName);
  if (res.error) return res;
  if (AppState.consol) AppState.consol.enabled = true; // adding a secondary means: consolidate
  return { ok: true, role: "secondary" };
}

/* ---------------- Dialog UI ---------------- */

const CONSOL_STYLE = `
  .consol-overlay{position:fixed;inset:0;background:rgba(12,18,28,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:5vh 16px;overflow:auto;}
  .consol-dialog{background:var(--card);color:inherit;border:1px solid var(--line);border-radius:12px;max-width:620px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.3);}
  .consol-dialog header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);}
  .consol-dialog header h2{margin:0;font-family:var(--disp);}
  .consol-dialog header .x{margin-left:auto;background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:var(--steel);}
  .consol-body{padding:14px 18px;max-height:74vh;overflow:auto;}
  .consol-primary{font-size:.9rem;margin-bottom:12px;}
  .consol-primary b{color:var(--ink);}
  .consol-sec-h{font:600 .72rem var(--disp);letter-spacing:.05em;text-transform:uppercase;color:var(--steel);margin:14px 0 6px;}
  .consol-list{display:flex;flex-direction:column;gap:6px;margin-bottom:6px;}
  .consol-row{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:.9rem;}
  .consol-row .w{font-weight:600;color:var(--ink);}
  .consol-row .src{color:var(--steel);font-size:.8rem;}
  .consol-row .rm{margin-left:auto;background:none;border:0;color:var(--warn);cursor:pointer;font-size:.85rem;}
  .consol-empty{color:var(--steel);font-size:.86rem;padding:4px 0;}
  .consol-drop{border:2px dashed #B9C4CE;border-radius:12px;min-height:78px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;text-align:center;cursor:pointer;padding:10px;transition:border-color .12s ease,background-color .12s ease;}
  .consol-drop:hover,.consol-drop.dragover{border-color:var(--accent);background:#FFF7F2;}
  .consol-drop:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
  .consol-drop svg{color:var(--accent);}
  .consol-drop-title{font-family:var(--disp);font-size:13px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--ink);}
  .consol-drop-sub{font-size:11px;color:var(--steel);}
  .consol-fetch-lbl{font:600 .68rem var(--disp);letter-spacing:.05em;text-transform:uppercase;color:var(--steel);margin:10px 0 4px;}
  .consol-fetch{display:flex;gap:6px;align-items:center;}
  .consol-fetch input{flex:1;min-width:0;padding:6px 9px;border:1px solid #B9C4CE;border-radius:6px;font-size:12.5px;background:var(--card);color:var(--ink);}
  .consol-fetch input:focus{outline:2px solid var(--accent);border-color:var(--accent);}
  .consol-fetch .btn{padding:6px 10px;font-size:12px;white-space:nowrap;}
  .consol-pick-hint{color:var(--steel);font-size:.82rem;margin:6px 0 2px;}
  .consol-pick-btn{display:block;width:100%;text-align:left;margin:4px 0;font-size:12.5px;}
  .consol-err{color:var(--warn);font-size:.85rem;margin-top:6px;min-height:0;}
  .consol-warn{border:1px solid var(--warn);background:#FFF6F2;border-radius:8px;padding:9px 11px;margin:12px 0;font-size:.85rem;color:var(--ink);}
  .consol-warn b{color:var(--warn);}
  .consol-summary{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 2px;}
  .consol-chip{font:600 .72rem var(--disp);letter-spacing:.04em;text-transform:uppercase;padding:4px 9px;border-radius:20px;border:1px solid var(--line);color:var(--steel);background:transparent;}
  .consol-pl-note{font-size:.85rem;color:var(--steel);margin:4px 0 8px;line-height:1.35;}
  .consol-pl-note b{color:var(--ink);}
  .consol-actions{display:flex;align-items:center;gap:10px;margin:14px 0 2px;flex-wrap:wrap;}
  .consol-toggle{display:flex;align-items:center;gap:7px;font-size:.9rem;}
  .consol-toggle input{width:16px;height:16px;}
`;

function closeConsol() {
  const o = document.getElementById("consolOverlay");
  if (o) o.remove();
  document.removeEventListener("keydown", _consolEscHandler);
}
function _consolEscHandler(e) { if (e.key === "Escape") closeConsol(); }

function openConsol() {
  closeConsol();
  _consolAtlasRecs = null;

  const overlay = el(`
    <div class="consol-overlay" id="consolOverlay">
      <div class="consol-dialog" role="dialog" aria-modal="true" aria-label="Consolidate WMTRs">
        <style>${CONSOL_STYLE}</style>
        <header>
          <h2>Consolidate WMTRs</h2>
          <button class="x" id="consolClose" title="Close" aria-label="Close">×</button>
        </header>
        <div class="consol-body" id="consolBody"></div>
      </div>
    </div>`);
  document.body.appendChild(overlay);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeConsol(); });
  overlay.querySelector("#consolClose").addEventListener("click", closeConsol);
  document.addEventListener("keydown", _consolEscHandler);

  _consolRenderBody();
}

/** Re-render the dialog body from current state. The window doubles as a UDQ
 *  loader: with nothing loaded it shows only the "add a UDQ" controls; the first
 *  UDQ added becomes the primary, the rest secondaries. */
function _consolRenderBody() {
  const body = document.getElementById("consolBody");
  if (!body) return;

  const primary = _consolPrimary();
  const pm = (primary && primary.meta) || {};
  const st = AppState.consol || { enabled: false, secondaries: [] };
  const secs = st.secondaries || [];

  // Add-UDQ controls — always present so the window works with nothing loaded.
  const addHtml = `
    <div class="consol-fetch-lbl">${primary ? "Add another UDQ — fetch from ATLAS" : "Add a UDQ — fetch from ATLAS"}</div>
    <div class="consol-fetch">
      <input type="text" id="consolWmtrInput" inputmode="numeric" placeholder="WMTR e.g. 10310" autocomplete="off" aria-label="WMTR number">
      <button class="btn primary" id="consolFetchBtn" type="button">Fetch</button>
    </div>
    <div id="consolPick"></div>

    <div class="consol-fetch-lbl">Or upload a UDQ file</div>
    <div class="consol-drop" id="consolDrop" tabindex="0" role="button" aria-label="Drop a UDQ Excel file, or click to browse">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
      <div class="consol-drop-title">Drop a UDQ</div>
      <div class="consol-drop-sub">or click to browse (.xlsx)</div>
      <input type="file" id="consolFile" accept=".xlsx,.xlsm" style="display:none">
    </div>
    <div class="consol-err" id="consolErr"></div>`;

  if (!primary) {
    body.innerHTML = `
      <div class="consol-primary"><b>No UDQ added yet.</b><br>
        <span class="src" style="color:var(--steel);font-size:.82rem">Add one or more UDQs. The first becomes the <b>primary</b> (its WMTR names every file); add more to merge their inventory as secondaries.</span></div>
      ${addHtml}`;
    _consolWireBody();
    return;
  }

  const rows = secs.length
    ? secs.map((s) => {
        const w = (s.data.meta && s.data.meta.wmtr) || s.wmtr || "";
        const label = s.last5 || w;
        const title = (s.data.meta && s.data.meta.request_title) || "";
        const n = (s.data.items || []).length;
        return `<div class="consol-row">
          <span class="w">WMTR ${esc(label)}</span>
          <span class="src">${esc(title || (s.source === "atlas" ? "from ATLAS" : s.fileName || "file"))} · ${n} item${n === 1 ? "" : "s"}</span>
          <button class="rm" type="button" data-wmtr="${esc(w)}" aria-label="Remove WMTR ${esc(label)}">Remove</button>
        </div>`;
      }).join("")
    : `<div class="consol-empty">No secondary WMTRs added yet — add more UDQs above to consolidate.</div>`;

  const warnings = consolCheckAddresses(primary, secs);
  const warnHtml = warnings.length
    ? `<div class="consol-warn"><b>⚠ Address mismatch.</b> These secondary WMTRs have a different ${""}address from the primary and were flagged for review: ` +
      esc(warnings.map((w) => `${w.label} (WMTR ${w.wmtr})`).join("; ")) +
      `. You can still consolidate — the primary's addresses are used on all documents.</div>`
    : "";

  const linkIssues = secs.length ? consolLinkageIssues(primary, secs) : [];
  const linkHtml = linkIssues.length
    ? `<div class="consol-warn"><b>⚠ ATLAS consolidation link missing.</b> ` +
      esc(linkIssues.map((i) => `WMTR ${i.wmtr} — ${i.status === "not-linked" ? "not linked to the primary in ATLAS" : "linked, but not as a Consolidation"}`).join("; ")) +
      `. Correction needed in ATLAS: link each request to the primary with linkage type “Consol”, then re-fetch the primary UDQ.</div>`
    : "";

  const collisions = secs.length ? consolShipGroupCollisions(primary, secs) : [];
  const collHtml = collisions.length
    ? `<div class="consol-warn"><b>⚠ Ship-group collision.</b> ` +
      esc(collisions.map((c) => `“${c.group}” is used by WMTRs ${c.wmtrs.join(", ")}`).join("; ")) +
      `. ATLAS ship-group numbers are only unique within one request, so keeping them would cross-link items from different WMTRs. Build the parents in the utility (recommended) or leave associations blank.</div>`
    : "";

  let summaryHtml = "";
  if (secs.length) {
    const combined = consolBuildCombined(primary, secs);
    const cm = combined.meta || {};
    summaryHtml = `<div class="consol-summary">
      <span class="consol-chip">${(combined.items || []).length} items</span>
      <span class="consol-chip">${esc(cm.total_pkgs || "0")} pkgs</span>
      <span class="consol-chip">${esc(cm.total_weight || "")}</span>
      <span class="consol-chip">${esc(cm.total_volume || "")}</span>
    </div>`;
  }

  body.innerHTML = `
    <div class="consol-primary">Primary WMTR: <b>${esc(pm.wmtr_last5 || pm.wmtr || "—")}</b>${pm.request_title ? " — " + esc(pm.request_title) : ""}<br>
      <span class="src" style="color:var(--steel);font-size:.82rem">The primary WMTR is used wherever a WMTR number is listed and to name every file.</span></div>

    <div class="consol-sec-h">Secondary WMTRs</div>
    <div class="consol-list" id="consolList">${rows}</div>

    ${addHtml}

    ${warnHtml}
    ${linkHtml}
    ${collHtml}
    ${summaryHtml}

    <div class="consol-sec-h" style="margin-top:14px">Packing List setup</div>
    <div class="consol-actions" style="margin-top:0">
      <button class="btn ghost" id="consolEditParents" type="button">Edit parent items</button>
      <button class="btn ghost" id="consolSplitItems" type="button">Assign ship groups / split items</button>
    </div>

    ${secs.length ? `<div class="consol-pl">
      <div class="consol-sec-h" style="margin-top:16px">Packing List parent items</div>
      <div class="consol-pl-note">Ship-group grouping can't be relied on across consolidated WMTRs, so the Packing List uses <b>manual parent items</b>. Prefill pulls every WMTR's parent (“P”) items in for review. Assigning ship groups to associate items is optional — leave them blank to list each parent with the combined inventory.${(typeof mpGlobalActive === "function" && mpGlobalActive()) ? ` <b>Manual parents are currently ON.</b>` : ""}</div>
      <label class="consol-toggle" style="margin:2px 0 8px"><input type="checkbox" id="consolKeepGroups"> Keep ATLAS ship-group associations (advanced)${collisions.length ? ` — <b style="color:var(--warn)">collisions detected</b>` : ""}</label>
      <button class="btn primary" id="consolPrefillBtn" type="button">Prefill &amp; review parent items</button>
    </div>` : ""}

    <div class="consol-actions">
      <label class="consol-toggle"><input type="checkbox" id="consolEnabled" ${st.enabled ? "checked" : ""} ${secs.length ? "" : "disabled"}> Use consolidation</label>
      <button class="btn primary" id="consolApply" type="button">Apply</button>
      <button class="btn ghost" id="consolCloseBtn" type="button">Close</button>
    </div>`;

  _consolWireBody();
}

function _consolWireBody() {
  const body = document.getElementById("consolBody");
  if (!body) return;
  const errEl = body.querySelector("#consolErr");
  const setErr = (m) => { if (errEl) errEl.textContent = m || ""; };

  // Remove buttons
  body.querySelectorAll(".consol-row .rm").forEach((b) => {
    b.addEventListener("click", () => {
      consolRemoveSecondary(b.getAttribute("data-wmtr"));
      if (!(AppState.consol.secondaries || []).length) AppState.consol.enabled = true; // reset default
      _consolRenderBody();
    });
  });

  // ATLAS fetch
  const input = body.querySelector("#consolWmtrInput");
  const fetchBtn = body.querySelector("#consolFetchBtn");
  const pick = body.querySelector("#consolPick");
  const doFetch = () => {
    _consolFetchAtlas(input.value, { btn: fetchBtn, err: errEl, pick }, (result, gmtr) => {
      const add = _consolAddUdq(result.data, result.grid, "", "atlas");
      if (add.error) { setErr(add.error); return; }
      _consolRenderBody();
    });
  };
  if (fetchBtn) fetchBtn.addEventListener("click", doFetch);
  if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter") doFetch(); });

  // File drop / browse
  const drop = body.querySelector("#consolDrop");
  const fileInput = body.querySelector("#consolFile");
  const handleFile = async (file) => {
    if (!file) return;
    setErr("");
    const res = await _consolParseFile(file);
    if (res.error) { setErr(res.error); return; }
    const add = _consolAddUdq(res.data, res.grid, res.fileName, "file");
    if (add.error) { setErr(add.error); return; }
    _consolRenderBody();
  };
  if (drop) {
    drop.addEventListener("click", () => fileInput && fileInput.click());
    drop.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput && fileInput.click(); }
    });
    for (const evt of ["dragover", "dragenter"]) {
      drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.add("dragover"); });
    }
    for (const evt of ["dragleave", "drop"]) {
      drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.remove("dragover"); });
    }
    drop.addEventListener("drop", (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
  }
  if (fileInput) fileInput.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    handleFile(f);
    e.target.value = "";
  });

  // Prefill Packing List parent items, then open the manual-parent window for review.
  const keepGroupsCb = body.querySelector("#consolKeepGroups");
  const prefillBtn = body.querySelector("#consolPrefillBtn");
  if (prefillBtn) prefillBtn.addEventListener("click", () => {
    setErr("");
    const res = consolPrefillManualParents({ keepGroups: !!(keepGroupsCb && keepGroupsCb.checked) });
    if (res.error) { setErr(res.error); return; }
    closeConsol();
    if (typeof openManualParents === "function") openManualParents();
  });

  const editParents = body.querySelector("#consolEditParents");
  if (editParents) editParents.addEventListener("click", () => {
    closeConsol();
    if (typeof openManualParents === "function") openManualParents();
  });
  const splitItems = body.querySelector("#consolSplitItems");
  if (splitItems) splitItems.addEventListener("click", () => {
    closeConsol();
    if (typeof openItemSplit === "function") openItemSplit();
  });

  // Enable toggle
  const enabled = body.querySelector("#consolEnabled");
  if (enabled) enabled.addEventListener("change", () => {
    _consolEnsureState().enabled = enabled.checked;
  });

  // Apply / Close
  const apply = body.querySelector("#consolApply");
  if (apply) apply.addEventListener("click", () => {
    if (enabled) _consolEnsureState().enabled = enabled.checked;
    closeConsol();
    if (typeof renderAll === "function") renderAll();
    const status = document.getElementById("loadStatus");
    if (status) {
      if (consolActive()) {
        const n = (AppState.consol.secondaries || []).length;
        status.textContent = `Consolidation ON — primary WMTR plus ${n} secondary WMTR${n === 1 ? "" : "s"}; documents use the combined inventory and totals.`;
        status.classList.remove("err");
      } else {
        status.textContent = "Consolidation off — using the single loaded WMTR.";
      }
    }
    if (typeof atlasAnnounce === "function") {
      try { atlasAnnounce(consolActive() ? "Consolidation applied." : "Consolidation turned off."); } catch (e) {}
    }
  });
  const closeBtn = body.querySelector("#consolCloseBtn");
  if (closeBtn) closeBtn.addEventListener("click", closeConsol);
}

/* ---------------- Button wiring ---------------- */

function initConsolButton() {
  const b = document.getElementById("consolBtn");
  if (b) b.addEventListener("click", openConsol);
}
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initConsolButton);
}

/* Node/tooling guard (no-op in the browser). */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    consolActive, consolReset, consolBuildCombined, consolApplyGlobal,
    consolCheckAddresses, consolSecondaryWmtrs, consolSecondaryLast5,
    consolAddSecondary, consolRemoveSecondary,
    consolPrefillManualParents, _consolPkgToManualRow,
    consolShipGroupCollisions, consolLinkageIssues,
    _consolAddUdq, _consolLoadPrimary,
  };
}
