/* =========================================================================
   ATLAS Utility Web — tools/manual_parents.js

   Manual parent-item override for SRF shipping documents.

   WHY THIS EXISTS
   ----------------
   ATLAS locks a request after Compliance Review, so parent items (Serial "P")
   can no longer be added to the Inventory List — even though a request can pass
   Compliance Review before everything has arrived and been packed, and the
   parent items can still change afterward. This lets the user enter their own
   parent items (count, final weight, final cube dimensions, ship group) for the
   purposes of shipping paperwork, overriding whatever was in the UDQ.

   DEFAULT BEHAVIOR (parity)
   -------------------------
   If the override is OFF, nothing changes: the UDQ's "P" rows drive package
   count, parent weights/dims, and ship groups exactly as before. The override
   is strictly opt-in.

   HOW THE OVERRIDE REACHES EVERY TOOL
   -----------------------------------
   Every shipping tool reads the same two things off the parsed data model:
     • data.packages           (parent rows — used by PL, Placards, RFQ)
     • data.meta.total_pkgs / total_weight / total_volume / totals_raw
                               (used by CI, PL chips, Placards fallback,
                                RFQ, and the pre-flight validator)
   So instead of editing each tool, we keep the pristine parse in
   AppState.dataBase and, when the override is enabled, swap AppState.data for a
   clone whose packages + totals are rebuilt from the manually-entered parents.
   Toggle it off and AppState.data points back at the pristine parse.

   WEIGHT / CUBE MODEL
   -------------------
   Each manual parent row describes ONE parent package and carries its own
   (per-package) final weight and dimensions, plus a "# of identical packages"
   count (default 1). Shipment totals are therefore:
       total packages = Σ count
       total weight   = Σ (count × per-package weight)
       total cube      = Σ (count × per-package volume)
   This matches how Placards expand a parent row into individual boxes (each box
   carries that parent's weight/dims) and keeps the PL crate cards showing the
   per-package weight while the header totals reflect the ×count sum.
   ========================================================================= */

/* ---- numeric helpers (tolerant of stray text/commas) ---- */

function mpNum(v) {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Trim a number for display in a dims string: 48 -> "48", 47.5 -> "47.5". */
function mpTrim(n) {
  const r = Math.round((+n + Number.EPSILON) * 100) / 100;
  return String(r);
}

/** A blank editable row for the dialog. */
function mpBlankRow() {
  return {
    description: "", L: "", W: "", H: "", dimUnit: "in",
    weight: "", weightUnit: "lbs", count: 1, ship_group: "",
  };
}

/** Does this row carry any usable data? (empty rows are ignored on save). */
function mpRowHasData(row) {
  if (!row) return false;
  return !!(String(row.description || "").trim() ||
            mpNum(row.weight) || mpNum(row.L) || mpNum(row.W) || mpNum(row.H) ||
            String(row.ship_group || "").trim());
}

/** Per-package + per-row roll-up for one manual row, normalized to lbs/in/ft³. */
function mpRowTotals(row) {
  const count = Math.max(1, Math.trunc(mpNum(row.count) || 1));
  const perLbs = row.weightUnit === "kg" ? mpNum(row.weight) / 0.45359237 : mpNum(row.weight);
  const perKg = perLbs * 0.45359237;
  const f = row.dimUnit === "cm" ? (1 / 2.54) : 1; // to inches
  const L = mpNum(row.L) * f, W = mpNum(row.W) * f, H = mpNum(row.H) * f;
  const perFt3 = (L && W && H) ? roundHalfUp((L * W * H) / 1728.0, 2) : 0;
  return { count, perLbs, perKg, perFt3 };
}

/* ---- override builder: pristine data -> overridden clone ---- */

/** Build the {packages, meta} override from a base data model + manual rows. */
function mpBuildOverride(base, mp) {
  const rows = ((mp && mp.items) || []).filter(mpRowHasData);

  let pkgCount = 0, totLbs = 0, totFt3 = 0;
  const packages = rows.map((row, i) => {
    const t = mpRowTotals(row);
    pkgCount += t.count;
    totLbs += t.count * t.perLbs;
    totFt3 += t.count * t.perFt3;

    const L = mpNum(row.L), W = mpNum(row.W), H = mpNum(row.H);
    const unit = row.dimUnit === "cm" ? "cm" : "in";
    // Keep the entered unit in the dims string so unit-aware consumers (PL)
    // convert correctly, and Placards print it for clarity.
    const dims = (L && W && H) ? `${mpTrim(L)} x ${mpTrim(W)} x ${mpTrim(H)} (${unit})` : "";

    return {
      row: 9000 + i,            // synthetic — manual rows have no UDQ row
      count: t.count,
      uoi: "",
      weight_lbs: t.perLbs ? String(roundHalfUp(t.perLbs, 2)) : "",
      weight_kg: t.perKg ? String(roundHalfUp(t.perKg, 2)) : "",
      dims,
      volume_ft3: t.perFt3,
      description: row.description || "",
      ship_group: row.ship_group || "",
      _manual: true,
    };
  });

  const totKg = totLbs * 0.45359237;
  const totFt3r = roundHalfUp(totFt3, 2);
  const totM3 = totFt3r * 0.028316846592;
  const baseRaw = (base.meta && base.meta.totals_raw) || {};

  const meta = Object.assign({}, base.meta, {
    total_pkgs: pkgCount ? String(pkgCount) : "",
    total_weight: fmtWeight(totLbs, totKg),
    total_volume: fmtVolume(totFt3r, totM3),
    totals_raw: Object.assign({}, baseRaw, {
      pkg_count: pkgCount,
      udq_lbs: totLbs, udq_kg: totKg,
      udq_ft3: totFt3r, udq_m3: totM3,
      // The manual parents ARE the authoritative package roll-up, so the
      // "UDQ vs packages" pre-flight check sees them agree (no false mismatch).
      pkg_lbs: totLbs, pkg_ft3: totFt3r,
    }),
    _manual_parents: true,
  });

  // items + parties unchanged; consumers never mutate them.
  return Object.assign({}, base, { meta, packages });
}

/* ---- apply / refresh against AppState ─────────────────────────────────────
   The override has TWO scopes:
     • a GLOBAL default (AppState.manualParents.enabled) — drives the dashboard,
       the pre-flight validator, the rail, and the action chip;
     • PER-DOCUMENT overrides (AppState.manualParents.perTool[toolId]) — let the
       user decide on the fly, in each shipping document's own window, whether
       that document uses the manual parents or the UDQ "P" rows.
   The dashboard/validation always reflect the global default; each document's
   workspace reflects its own per-tool choice (defaulting to the global one). */

/** Shipping documents whose output actually depends on parent items. SLI is
 *  intentionally excluded — it lists inventory and leaves package weight blank,
 *  so manual parents have no effect on it. */
const MP_CAPABLE_TOOLS = ["ci", "pl", "placards", "rfq", "packet"];
function mpManualCapable(toolId) { return MP_CAPABLE_TOOLS.indexOf(toolId) !== -1; }

/** Are there any usable manual parent rows entered? */
function mpHasRows() {
  const mp = (typeof AppState !== "undefined") ? AppState.manualParents : null;
  return !!(mp && (mp.items || []).some(mpRowHasData));
}

/** The GLOBAL default is on (and there's data to use). */
function mpGlobalActive() {
  const mp = (typeof AppState !== "undefined") ? AppState.manualParents : null;
  return !!(mp && mp.enabled && mpHasRows());
}

/** Does this specific tool use the manual parents? perTool override, else
 *  the global default. */
function mpToolUsesManual(toolId) {
  const mp = (typeof AppState !== "undefined") ? AppState.manualParents : null;
  if (!mp) return false;
  const pt = mp.perTool || {};
  if (typeof pt[toolId] === "boolean") return pt[toolId];
  return !!mp.enabled;
}

/** The data a given scope should see (toolId null/"" = global default). */
function mpEffectiveData(toolId) {
  if (typeof AppState === "undefined") return null;
  const base = AppState.dataBase || AppState.data;
  if (!base || AppState.udqType !== "srf") return base;
  AppState.dataBase = base; // make sure the pristine copy is captured
  const wantManual = (toolId == null) ? mpGlobalActive()
                                      : (mpHasRows() && mpToolUsesManual(toolId));
  return wantManual ? mpBuildOverride(base, AppState.manualParents) : base;
}

/** Point AppState.data at the GLOBAL-default view (dashboard / validation / rail). */
function mpApplyGlobal() {
  const d = mpEffectiveData(null);
  if (d) AppState.data = d;
}

/** Point AppState.data at the ACTIVE tool's view (its workspace + generate). */
function mpApplyForActiveTool() {
  const d = mpEffectiveData(AppState && AppState.activeTool);
  if (d) AppState.data = d;
}

/** Apply + full re-render (dashboard, rail, active tool, chips). */
function mpApplyAndRefresh() {
  mpApplyGlobal();
  if (typeof renderAll === "function") renderAll();
}

/** Refresh just the active document's live preview in place (keeps form state). */
function mpRefreshActivePreview(toolId) {
  const fns = {
    ci: (typeof updateCiPreview === "function") ? updateCiPreview : null,
    pl: (typeof updatePlPreview === "function") ? updatePlPreview : null,
    placards: (typeof updatePlacardsPreview === "function") ? updatePlacardsPreview : null,
    rfq: (typeof updateRfqPreview === "function") ? updateRfqPreview : null,
  };
  const fn = fns[toolId];
  if (fn) { try { fn(); } catch (e) { /* preview will catch up on next render */ } }
}

/* =========================================================================
   Per-WMTR persistence

   Saved manual parent overrides are keyed by WMTR number in localStorage, so a
   user can switch UDQs and later reopen a previous one: the utility recognizes
   the WMTR and restores the parents that were entered for it. Stored under the
   "atlas." namespace, so the existing Settings backup/restore covers it too.
   ========================================================================= */

const MP_STORE_KEY = "atlas.parents";

function mpStoreLoad() {
  try {
    const raw = (typeof localStorage !== "undefined") ? localStorage.getItem(MP_STORE_KEY) : null;
    const o = raw ? JSON.parse(raw) : {};
    return (o && typeof o === "object") ? o : {};
  } catch (e) { return {}; }
}
function mpStoreSave(map) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(MP_STORE_KEY, JSON.stringify(map)); return true; }
  catch (e) { return false; }
}

/** The current shipment's WMTR (from the pristine parse). "" if unknown. */
function mpCurrentWmtr() {
  if (typeof AppState === "undefined") return "";
  const b = AppState.dataBase || AppState.data;
  return (b && b.meta && b.meta.wmtr) ? String(b.meta.wmtr).trim() : "";
}

/** Save (or clear) the current WMTR's override to localStorage. */
function mpPersistCurrent() {
  const wmtr = mpCurrentWmtr();
  if (!wmtr) return;
  const map = mpStoreLoad();
  const mp = AppState.manualParents;
  if (mp && (mp.items || []).some(mpRowHasData)) {
    map[wmtr] = {
      enabled: !!mp.enabled,
      items: mp.items.filter(mpRowHasData),
      perTool: mp.perTool || {},
      savedAt: new Date().toISOString(),
    };
  } else {
    delete map[wmtr]; // nothing meaningful to keep
  }
  mpStoreSave(map);
}

/** Restore a saved override into AppState.manualParents for a WMTR.
 *  Returns true if something was restored. */
function mpRestoreForWmtr(wmtr) {
  if (!wmtr) return false;
  const e = mpStoreLoad()[wmtr];
  if (e && Array.isArray(e.items) && e.items.some(mpRowHasData)) {
    AppState.manualParents = {
      enabled: !!e.enabled,
      items: e.items.map((r) => Object.assign(mpBlankRow(), r)),
      perTool: e.perTool || {},
      _restored: true,
    };
    return true;
  }
  return false;
}

/** Called from loadFile right after an SRF UDQ is parsed. Restores any saved
 *  override for this WMTR and flags it on the load status line. */
function mpOnSrfLoaded() {
  if (typeof AppState === "undefined" || AppState.udqType !== "srf") return;
  const wmtr = mpCurrentWmtr();
  if (!wmtr) return;
  if (mpRestoreForWmtr(wmtr)) {
    mpApplyGlobal();
    const status = document.getElementById("loadStatus");
    if (status) {
      const active = mpGlobalActive();
      const pkgs = (AppState.data.meta.total_pkgs || "0");
      status.textContent += active
        ? `  •  Recognized this WMTR — restored your saved manual parent items (${pkgs} package(s)); shipping documents are using them.`
        : `  •  Recognized this WMTR — restored your saved manual parent items (currently turned off).`;
    }
    if (typeof atlasAnnounce === "function") {
      try { atlasAnnounce("Saved manual parent items were restored for this WMTR."); } catch (e) {}
    }
  }
}

/* =========================================================================
   Export / import saved overrides (portable JSON)

   A direct backup of just the saved parent overrides, for moving between
   browsers or keeping a copy before clearing cache. (The full Settings backup
   in Settings also includes these now.)
   ========================================================================= */

function mpBuildExport() {
  return {
    app: (typeof APP_NAME !== "undefined" ? APP_NAME : "ATLAS Utility") + " Web",
    kind: "atlas-parent-items",
    schema: 1,
    exportedAt: new Date().toISOString(),
    parents: mpStoreLoad(),
  };
}

function mpExportSaved() {
  const map = mpStoreLoad();
  const n = Object.keys(map).length;
  if (!n) { alert("There are no saved manual parent items to export yet."); return; }
  const json = JSON.stringify(mpBuildExport(), null, 2);
  const stamp = (typeof fileStamp === "function") ? fileStamp() : Date.now();
  const a = document.createElement("a");
  a.href = "data:application/json;charset=utf-8," + encodeURIComponent(json);
  a.download = `ATLAS_ParentItems_${stamp}.json`;
  a.dataset.auditSkip = "1";
  document.body.appendChild(a); a.click();
  setTimeout(() => document.body.removeChild(a), 500);
}

/** Merge an imported export file into storage. Returns count imported. */
function mpImportSavedObject(obj) {
  const incoming = (obj && obj.kind === "atlas-parent-items" && obj.parents && typeof obj.parents === "object")
    ? obj.parents
    : (obj && typeof obj === "object" && !obj.kind ? obj : null); // tolerate a bare map
  if (!incoming) return { ok: false, count: 0 };
  const map = mpStoreLoad();
  let count = 0;
  for (const wmtr of Object.keys(incoming)) {
    const e = incoming[wmtr];
    if (e && Array.isArray(e.items)) { map[wmtr] = e; count++; }
  }
  mpStoreSave(map);
  return { ok: true, count };
}

function mpImportSavedFromFile(file, onDone) {
  const reader = new FileReader();
  reader.onload = () => {
    let obj = null;
    try { obj = JSON.parse(String(reader.result || "")); } catch (e) { obj = null; }
    if (!obj) { alert("That file isn't a valid ATLAS parent-items export."); return; }
    const res = mpImportSavedObject(obj);
    if (!res.ok) { alert("That file isn't a valid ATLAS parent-items export."); return; }
    if (typeof onDone === "function") onDone(res.count);
  };
  reader.readAsText(file);
}

/* =========================================================================
   Dashboard banner — a clear, unmistakable flag that manual parents are active
   ========================================================================= */

function mpDashboardBanner() {
  if (typeof AppState === "undefined" || AppState.udqType !== "srf") return null;
  if (!mpGlobalActive()) return null;
  mpEnsureDocStyle();
  const m = AppState.data.meta;
  const restored = !!(AppState.manualParents && AppState.manualParents._restored);
  const banner = el(`
    <div class="mp-banner" role="status">
      <span class="mp-banner-badge">MANUAL</span>
      <span class="mp-banner-txt">
        <strong>Manual parent items in use.</strong>
        Package count, weight, cube and ship groups for the shipping documents come from
        manually-entered parents${restored ? " restored for this WMTR" : ""} — not the UDQ.
        <span class="mp-banner-fig">${esc(m.total_pkgs || "0")} pkg · ${esc(m.total_weight || "—")} · ${esc(m.total_volume || "—")}</span>
      </span>
      <span class="mp-banner-actions">
        <button class="btn ghost mp-banner-btn" type="button" id="mpBannerEdit">Edit parent items</button>
      </span>
    </div>`);
  banner.querySelector("#mpBannerEdit").addEventListener("click", openManualParents);
  return banner;
}

/* ---- action chip (rendered by udq_tools.renderUdqActions) ---- */

function mpRenderActionChip(host) {
  if (!host) return;
  if (typeof AppState === "undefined" || AppState.udqType !== "srf" || !AppState.data) return;
  if (host.querySelector("#udqMpBtn")) return;
  const on = mpGlobalActive();
  if (host.children.length) host.appendChild(el(`<span class="udq-sep" aria-hidden="true">·</span>`));
  const label = on ? "Manual parent items \u2713" : "Manual parent items";
  const btn = el(`<button class="linkbtn${on ? " active" : ""}" type="button" id="udqMpBtn">${label}</button>`);
  btn.addEventListener("click", openManualParents);
  host.appendChild(btn);
}

/* =========================================================================
   Per-document toggle bar (injected into each capable tool's workspace)
   ========================================================================= */

function mpEnsureDocStyle() {
  if (document.getElementById("mpDocStyle")) return;
  const s = document.createElement("style");
  s.id = "mpDocStyle";
  s.textContent = `
  .mp-docbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 14px;padding:9px 12px;
    border:1px solid var(--line);border-left:4px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);transition:background .15s,border-color .15s;}
  .mp-docbar.on{border-left-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);}
  .mp-docbar .mp-db-lbl{font:600 .8rem var(--disp);letter-spacing:.02em;color:var(--ink);text-transform:uppercase;}
  .mp-docbar .mp-db-badge{display:none;font:700 .68rem var(--disp);letter-spacing:.06em;background:var(--accent);color:#fff;border-radius:5px;padding:2px 7px;}
  .mp-docbar.on .mp-db-badge{display:inline-block;}
  .mp-docbar .mp-db-state{font-size:.86rem;color:var(--steel);}
  .mp-docbar .mp-db-state strong{color:var(--ink);}
  .mp-docbar .mp-db-edit{margin-left:auto;}
  /* Compact variant of the app's standard ghost button, for inline bars. */
  .btn.btn-sm{font-size:12px;letter-spacing:.6px;padding:6px 12px;}
  .mp-switch{position:relative;display:inline-block;width:46px;height:24px;flex:0 0 auto;}
  .mp-switch input{opacity:0;width:0;height:0;}
  .mp-switch .mp-track{position:absolute;cursor:pointer;inset:0;background:#9aa4b2;border-radius:24px;transition:.15s;}
  .mp-switch .mp-track:before{content:"";position:absolute;height:18px;width:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.15s;box-shadow:0 1px 2px rgba(0,0,0,.3);}
  .mp-switch input:checked + .mp-track{background:var(--accent);}
  .mp-switch input:checked + .mp-track:before{transform:translateX(22px);}
  .mp-switch input:disabled + .mp-track{opacity:.45;cursor:not-allowed;}
  /* Dashboard banner — strong, theme-safe flag (accent border + badge). */
  .mp-banner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 14px;padding:11px 14px;
    border:1px solid var(--accent);border-left:5px solid var(--accent);border-radius:10px;
    background:var(--card);color:var(--ink);box-shadow:inset 0 0 0 1px var(--accent);}
  .mp-banner .mp-banner-badge{font:700 .72rem var(--disp);letter-spacing:.06em;background:var(--accent);color:#fff;border-radius:6px;padding:3px 9px;flex:0 0 auto;}
  .mp-banner .mp-banner-txt{font-size:.9rem;line-height:1.4;flex:1 1 320px;}
  .mp-banner .mp-banner-txt strong{color:var(--ink);}
  .mp-banner .mp-banner-fig{display:inline-block;margin-left:4px;color:var(--steel);font-family:var(--mono);font-size:.82rem;}
  .mp-banner .mp-banner-actions{margin-left:auto;flex:0 0 auto;}
  `;
  document.head.appendChild(s);
}

function _mpDocBarStateHtml(toolId) {
  const hasRows = mpHasRows();
  if (!hasRows) return `Using <strong>UDQ “P” rows</strong> — no manual parents entered yet.`;
  return mpToolUsesManual(toolId)
    ? `Using <strong>manual parent items</strong> for this document.`
    : `Using <strong>UDQ “P” rows</strong> for this document.`;
}

/** Inject the per-document parent-source toggle at the top of the tool panel. */
function mpInjectDocToggle(container, toolId) {
  if (!container) return;
  if (typeof AppState === "undefined" || AppState.udqType !== "srf" || !AppState.data) return;
  if (!mpManualCapable(toolId)) return;
  mpEnsureDocStyle();

  const hasRows = mpHasRows();
  const on = hasRows && mpToolUsesManual(toolId);

  const bar = el(`
    <div class="mp-docbar${on ? " on" : ""}">
      <span class="mp-db-lbl">Parent items</span>
      <span class="mp-db-badge">MANUAL</span>
      <label class="mp-switch" title="Use manual parent items for this document">
        <input type="checkbox" id="mpDocToggle" ${on ? "checked" : ""} ${hasRows ? "" : "disabled"}
               aria-label="Use manual parent items for this document">
        <span class="mp-track"></span>
      </label>
      <span class="mp-db-state" id="mpDocState">${_mpDocBarStateHtml(toolId)}</span>
      <button class="btn ghost btn-sm mp-db-edit" type="button" id="mpDocEdit">${hasRows ? "Edit parent items" : "Set up parent items"}</button>
    </div>`);

  const body = container.querySelector(".panel > .body") || container.querySelector(".panel") || container;
  body.insertBefore(bar, body.firstChild);

  bar.querySelector("#mpDocEdit").addEventListener("click", openManualParents);

  const input = bar.querySelector("#mpDocToggle");
  input.addEventListener("change", () => {
    const mp = AppState.manualParents = AppState.manualParents || { enabled: false, items: [], perTool: {} };
    mp.perTool = mp.perTool || {};
    mp.perTool[toolId] = input.checked;
    mpPersistCurrent();                      // remember this per-document choice for the WMTR
    mpApplyForActiveTool();                  // swap AppState.data for this document
    mpRefreshActivePreview(toolId);          // rebuild preview in place (keeps form state)
    bar.classList.toggle("on", mpToolUsesManual(toolId) && mpHasRows());
    const st = bar.querySelector("#mpDocState");
    if (st) st.innerHTML = _mpDocBarStateHtml(toolId);
    if (typeof renderUdqActions === "function") renderUdqActions();
  });
}

/* =========================================================================
   Dialog
   ========================================================================= */

const MP_STYLE = `
  .mp-overlay{position:fixed;inset:0;background:rgba(12,18,28,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1100;padding:5vh 16px;overflow:auto;}
  .mp-dialog{background:var(--card);color:inherit;border:1px solid var(--line);border-radius:12px;max-width:920px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.3);}
  .mp-dialog header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);}
  .mp-dialog header h2{margin:0;font:600 1.05rem var(--disp);}
  .mp-dialog header .x{margin-left:auto;background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:var(--steel);}
  .mp-body{padding:14px 18px;max-height:72vh;overflow:auto;}
  .mp-intro{font-size:.9rem;color:var(--steel);margin:0 0 10px;line-height:1.45;}
  .mp-intro strong{color:inherit;}
  .mp-intro-sub{display:inline-block;margin-top:4px;font-size:.82rem;color:var(--steel);}
  .mp-toggle{display:flex;align-items:flex-start;gap:9px;border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:9px;padding:10px 12px;margin-bottom:12px;background:var(--card);color:var(--ink);}
  .mp-toggle input{margin-top:3px;flex:0 0 auto;width:16px;height:16px;accent-color:var(--accent);}
  .mp-toggle label{font-size:.92rem;line-height:1.4;cursor:pointer;color:var(--ink);}
  .mp-toggle .hint{display:block;color:var(--steel);font-size:.82rem;margin-top:2px;}
  .mp-tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:9px;}
  table.mp-table{border-collapse:collapse;width:100%;min-width:780px;font-size:.86rem;}
  table.mp-table th{text-align:left;font:600 .72rem/1.2 var(--disp);letter-spacing:.03em;text-transform:uppercase;color:var(--steel);padding:8px 6px;border-bottom:1px solid var(--line);white-space:nowrap;}
  table.mp-table td{padding:5px 6px;border-bottom:1px solid var(--line);vertical-align:middle;}
  table.mp-table tr:last-child td{border-bottom:0;}
  table.mp-table input,table.mp-table select{width:100%;box-sizing:border-box;background:var(--card);color:inherit;border:1px solid var(--line);border-radius:6px;padding:5px 6px;font:inherit;font-size:.85rem;}
  table.mp-table input.mp-dim{width:58px;text-align:right;}
  table.mp-table input.mp-wt{width:74px;text-align:right;}
  table.mp-table input.mp-cnt{width:54px;text-align:right;}
  table.mp-table input.mp-grp{width:84px;}
  table.mp-table .mp-dimcell{display:flex;align-items:center;gap:4px;white-space:nowrap;}
  table.mp-table .mp-dimcell span{color:var(--steel);}
  .mp-del{background:none;border:1px solid var(--line);border-radius:6px;color:var(--steel);cursor:pointer;width:26px;height:26px;line-height:1;font-size:15px;}
  .mp-del:hover{color:#b32424;border-color:rgba(179,36,36,.5);}
  .mp-add{margin-top:10px;}
  .mp-sum{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;}
  .mp-chip{border:1px solid var(--line);border-radius:9px;padding:8px 12px;min-width:96px;}
  .mp-chip .v{font:600 1.05rem var(--disp);}
  .mp-chip .k{color:var(--steel);font-size:.74rem;text-transform:uppercase;letter-spacing:.03em;margin-top:1px;}
  .mp-foot{display:flex;align-items:center;gap:10px;padding:14px 18px;border-top:1px solid var(--line);}
  .mp-foot .spacer{margin-left:auto;}
  .mp-note{color:var(--steel);font-size:.82rem;}
`;

/** Working copy of rows while the dialog is open. */
let _mpDraft = null;

function closeManualParents() {
  const o = document.getElementById("mpOverlay");
  if (o) o.remove();
  document.removeEventListener("keydown", _mpEsc);
  _mpDraft = null;
}
function _mpEsc(e) { if (e.key === "Escape") closeManualParents(); }

/** Seed the editable rows: prior manual entries → else prefill from UDQ "P"
 *  rows so the user can tweak rather than retype → else one blank row. */
function mpInitialRows() {
  const mp = (typeof AppState !== "undefined") ? AppState.manualParents : null;
  if (mp && mp.items && mp.items.length) return mp.items.map((r) => Object.assign(mpBlankRow(), r));

  const base = (typeof AppState !== "undefined") ? (AppState.dataBase || AppState.data) : null;
  const pkgs = (base && base.packages) || [];
  if (pkgs.length) {
    return pkgs.map((p) => {
      const [L, W, H] = (typeof parseDimsIn === "function") ? parseDimsIn(p.dims || "") : [0, 0, 0];
      return Object.assign(mpBlankRow(), {
        description: p.description || "",
        L: L || "", W: W || "", H: H || "", dimUnit: "in",
        weight: p.weight_lbs || "", weightUnit: "lbs",
        count: p.count || 1,
        ship_group: p.ship_group || "",
      });
    });
  }
  return [mpBlankRow()];
}

function _mpRowHtml(row, i) {
  const sel = (cur, val) => (cur === val ? " selected" : "");
  return `
    <tr data-idx="${i}">
      <td><input type="text" data-f="description" value="${esc(row.description)}" placeholder="e.g. Wooden crate / pallet"></td>
      <td>
        <div class="mp-dimcell">
          <input class="mp-dim" type="text" inputmode="decimal" data-f="L" value="${esc(row.L)}" placeholder="L" aria-label="Length">
          <span>×</span>
          <input class="mp-dim" type="text" inputmode="decimal" data-f="W" value="${esc(row.W)}" placeholder="W" aria-label="Width">
          <span>×</span>
          <input class="mp-dim" type="text" inputmode="decimal" data-f="H" value="${esc(row.H)}" placeholder="H" aria-label="Height">
          <select data-f="dimUnit" aria-label="Dimension unit"><option value="in"${sel(row.dimUnit, "in")}>in</option><option value="cm"${sel(row.dimUnit, "cm")}>cm</option></select>
        </div>
      </td>
      <td>
        <div class="mp-dimcell">
          <input class="mp-wt" type="text" inputmode="decimal" data-f="weight" value="${esc(row.weight)}" placeholder="0" aria-label="Weight">
          <select data-f="weightUnit" aria-label="Weight unit"><option value="lbs"${sel(row.weightUnit, "lbs")}>lbs</option><option value="kg"${sel(row.weightUnit, "kg")}>kg</option></select>
        </div>
      </td>
      <td><input class="mp-cnt" type="text" inputmode="numeric" data-f="count" value="${esc(row.count)}" aria-label="Number of identical packages"></td>
      <td><input class="mp-grp" type="text" data-f="ship_group" value="${esc(row.ship_group)}" placeholder="(optional)" aria-label="Ship group"></td>
      <td><button class="mp-del" type="button" title="Remove this parent" aria-label="Remove this parent">×</button></td>
    </tr>`;
}

function _mpRenderRows() {
  const tbody = document.getElementById("mpRows");
  if (!tbody) return;
  tbody.innerHTML = _mpDraft.map((r, i) => _mpRowHtml(r, i)).join("");
}

/** Read the live DOM values back into _mpDraft (keeps focus undisturbed). */
function _mpReadRowsFromDom() {
  const tbody = document.getElementById("mpRows");
  if (!tbody) return;
  const out = [];
  tbody.querySelectorAll("tr[data-idx]").forEach((tr) => {
    const row = mpBlankRow();
    tr.querySelectorAll("[data-f]").forEach((inp) => { row[inp.dataset.f] = inp.value; });
    out.push(row);
  });
  _mpDraft = out;
}

function _mpUpdateSummary() {
  let pkgCount = 0, totLbs = 0, totFt3 = 0;
  for (const row of _mpDraft) {
    if (!mpRowHasData(row)) continue;
    const t = mpRowTotals(row);
    pkgCount += t.count;
    totLbs += t.count * t.perLbs;
    totFt3 += t.count * t.perFt3;
  }
  const totKg = totLbs * 0.45359237;
  const totFt3r = roundHalfUp(totFt3, 2);
  const totM3 = totFt3r * 0.028316846592;
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set("mpSumPkgs", String(pkgCount));
  set("mpSumWt", totLbs ? `${(Math.round(totLbs * 100) / 100).toLocaleString("en-US")} lbs` : "—");
  set("mpSumWtKg", totKg ? `${(Math.round(totKg * 100) / 100).toLocaleString("en-US")} kg` : "—");
  set("mpSumVol", totFt3r ? `${totFt3r.toLocaleString("en-US")} ft³` : "—");
  set("mpSumVolM", totM3 ? `${(Math.round(totM3 * 100) / 100).toLocaleString("en-US")} m³` : "—");
}

function openManualParents() {
  if (typeof AppState === "undefined" || AppState.udqType !== "srf" || !AppState.data) {
    alert("Load an SRF UDQ first — manual parent items apply to SRF shipping documents.");
    return;
  }
  closeManualParents();

  _mpDraft = mpInitialRows();
  const base = AppState.dataBase || AppState.data;
  const udqPkgs = (base && base.packages) || [];
  const mp = AppState.manualParents;
  const startEnabled = mp ? !!mp.enabled : false;

  const udqNote = udqPkgs.length
    ? `This UDQ already contains <strong>${udqPkgs.length}</strong> parent “P” row${udqPkgs.length === 1 ? "" : "s"}. ` +
      `Leaving the override off keeps using them. Turning it on replaces them with the rows below for all shipping documents.`
    : `This UDQ has <strong>no</strong> parent “P” rows. Enter your parents below and turn the override on to drive the shipping documents.`;

  const overlay = el(`
    <div class="mp-overlay" id="mpOverlay">
      <div class="mp-dialog" role="dialog" aria-modal="true" aria-label="Manual parent items">
        <style>${MP_STYLE}</style>
        <header><h2>Manual parent items</h2><button class="x" id="mpX" title="Close" aria-label="Close">×</button></header>
        <div class="mp-body">
          <p class="mp-intro">Enter the parent items (crates / pallets / boxes) with their <strong>final weight</strong>,
            <strong>cube dimensions</strong>, and <strong>ship group</strong>. When the override is on, the Commercial Invoice,
            Packing List, Placards and other shipping documents use these to calculate total weight, total cube, and the number
            of packages — even if the UDQ already has values. ${udqNote}
            <br><span class="mp-intro-sub">“# Pkgs” is how many identical packages a row represents; weight &amp; dimensions are
            per package. Entries are saved for this WMTR, so they’ll come back automatically if you reopen this UDQ later.</span></p>

          <div class="mp-toggle">
            <input type="checkbox" id="mpEnabled" ${startEnabled ? "checked" : ""}>
            <label for="mpEnabled">Use these manual parent items for all shipping documents (override the UDQ)
              <span class="hint">Off = use the UDQ’s “P” rows as normal. You can keep rows saved here and toggle this any time.</span>
            </label>
          </div>

          <div class="mp-tablewrap">
            <table class="mp-table">
              <thead><tr>
                <th style="min-width:220px;">Description</th>
                <th>Dimensions (L × W × H)</th>
                <th>Weight (per package)</th>
                <th># Pkgs</th>
                <th>Ship group</th>
                <th aria-label="Remove"></th>
              </tr></thead>
              <tbody id="mpRows"></tbody>
            </table>
          </div>
          <button class="btn ghost mp-add" id="mpAdd" type="button">+ Add parent item</button>

          <div class="mp-sum">
            <div class="mp-chip"><div class="v" id="mpSumPkgs">0</div><div class="k">Total packages</div></div>
            <div class="mp-chip"><div class="v" id="mpSumWt">—</div><div class="k">Total weight (lbs)</div></div>
            <div class="mp-chip"><div class="v" id="mpSumWtKg">—</div><div class="k">Total weight (kg)</div></div>
            <div class="mp-chip"><div class="v" id="mpSumVol">—</div><div class="k">Total cube (ft³)</div></div>
            <div class="mp-chip"><div class="v" id="mpSumVolM">—</div><div class="k">Total cube (m³)</div></div>
          </div>
        </div>
        <div class="mp-foot">
          <button class="btn ghost btn-sm" id="mpSplitItems" type="button" title="Assign ship groups to inventory lines, or split a line's quantity across pallets">Ship groups &amp; splits…</button>
          <button class="btn ghost btn-sm" id="mpExport" type="button" title="Download all saved parent items as a JSON file">Export saved (.json)</button>
          <button class="btn ghost btn-sm" id="mpImport" type="button" title="Import parent items from a JSON file">Import (.json)</button>
          <input type="file" id="mpImportFile" accept=".json,application/json" style="display:none">
          <span class="spacer"></span>
          <button class="btn ghost" id="mpCancel" type="button">Cancel</button>
          <button class="btn primary" id="mpSave" type="button">Save</button>
        </div>
      </div>
    </div>`);

  document.body.appendChild(overlay);
  _mpRenderRows();
  _mpUpdateSummary();

  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeManualParents(); });
  overlay.querySelector("#mpX").addEventListener("click", closeManualParents);
  overlay.querySelector("#mpCancel").addEventListener("click", closeManualParents);
  document.addEventListener("keydown", _mpEsc);

  // Editing the parent items at all means the user intends to use them, so
  // auto-check the enable box (they can still uncheck it before saving).
  const autoEnable = () => {
    const cb = document.getElementById("mpEnabled");
    if (cb && !cb.checked) cb.checked = true;
  };

  // Live recompute on any field change.
  const tbody = overlay.querySelector("#mpRows");
  const onInput = () => { autoEnable(); _mpReadRowsFromDom(); _mpUpdateSummary(); };
  tbody.addEventListener("input", onInput);
  tbody.addEventListener("change", onInput);

  // Remove a row.
  tbody.addEventListener("click", (e) => {
    const del = e.target.closest(".mp-del");
    if (!del) return;
    autoEnable();
    _mpReadRowsFromDom();
    const tr = del.closest("tr[data-idx]");
    const idx = Number(tr.dataset.idx);
    _mpDraft.splice(idx, 1);
    if (!_mpDraft.length) _mpDraft = [mpBlankRow()];
    _mpRenderRows();
    _mpUpdateSummary();
  });

  // Split line items — opens the line-item split editor (children -> parts).
  const splitBtn = overlay.querySelector("#mpSplitItems");
  if (splitBtn) splitBtn.addEventListener("click", () => {
    if (typeof openItemSplit === "function") openItemSplit();
    else alert("Line-item splitting isn't available (item_split.js not loaded).");
  });

  // Add a row.
  overlay.querySelector("#mpAdd").addEventListener("click", () => {
    autoEnable();
    _mpReadRowsFromDom();
    _mpDraft.push(mpBlankRow());
    _mpRenderRows();
    _mpUpdateSummary();
  });

  // Save.
  overlay.querySelector("#mpSave").addEventListener("click", () => {
    _mpReadRowsFromDom();
    const enabled = !!overlay.querySelector("#mpEnabled").checked;
    const rows = _mpDraft.filter(mpRowHasData).map((r) => Object.assign(mpBlankRow(), r));

    if (enabled && !rows.length) {
      alert("Add at least one parent item (with a description, weight, or dimensions) before enabling the override.");
      return;
    }

    const prevPerTool = (AppState.manualParents && AppState.manualParents.perTool) || {};
    AppState.manualParents = { enabled, items: rows, perTool: prevPerTool };
    mpPersistCurrent();              // remember these entries for this WMTR
    closeManualParents();
    mpApplyAndRefresh();

    const status = document.getElementById("loadStatus");
    if (status) {
      if (enabled) {
        const pkgs = (AppState.data.meta.total_pkgs || "0");
        status.textContent = `Manual parent items ON — ${pkgs} package(s), ` +
          `${AppState.data.meta.total_weight || "no weight"}. Shipping documents now use these values.`;
        status.classList.remove("err");
      } else {
        status.textContent = `Manual parent items saved but OFF — shipping documents use the UDQ’s “P” rows.`;
        status.classList.remove("err");
      }
    }
    if (typeof atlasAnnounce === "function") {
      try { atlasAnnounce(enabled ? "Manual parent items enabled." : "Manual parent items saved, override off."); } catch (e) {}
    }
  });

  // Export all saved overrides to a JSON file.
  overlay.querySelector("#mpExport").addEventListener("click", mpExportSaved);

  // Import overrides from a JSON file, then offer to load this WMTR's set.
  const fileInput = overlay.querySelector("#mpImportFile");
  overlay.querySelector("#mpImport").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    mpImportSavedFromFile(f, (count) => {
      const wmtr = mpCurrentWmtr();
      const haveThis = wmtr && mpStoreLoad()[wmtr];
      let msg = `Imported saved parent items for ${count} WMTR${count === 1 ? "" : "s"}.`;
      if (haveThis) msg += `\n\nThis file includes entries for the current WMTR (${wmtr}). Load them now?`;
      if (haveThis && confirm(msg)) {
        if (mpRestoreForWmtr(wmtr)) { mpPersistCurrent(); closeManualParents(); mpApplyAndRefresh(); return; }
      } else {
        alert(msg);
      }
      // Refresh the dialog so a re-open reflects imported data.
      closeManualParents();
      openManualParents();
    });
    fileInput.value = "";
  });
}

/* ---------- Node test support ---------- */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    mpNum, mpTrim, mpBlankRow, mpRowHasData, mpRowTotals,
    mpBuildOverride, mpManualCapable,
  };
}
