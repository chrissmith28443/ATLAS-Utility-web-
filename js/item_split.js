/* =========================================================================
   ATLAS Utility Web — item_split.js
   Manual line-item splitting for SRF shipping documents.

   WHY THIS EXISTS
   ----------------
   ATLAS locks a request's Inventory List after Compliance Review, but cargo is
   often split across packages AFTER that point (e.g. 25 units of salt: 1 unit on
   one pallet, 24 on another). The UDQ still shows the single line "25", so there
   is no way to place different quantities on different parents for the Packing
   List. This lets the user split one line item into several parts — each with its
   own quantity and (optionally) its own ship group — so the parts can be
   associated to different manual parents on the PL.

   HOW IT PLUGS IN
   ----------------
   Every tool reads data.items. We keep the pristine base in AppState.siBase and,
   when the override is enabled, rebuild data.items so each split line becomes
   several rows. siApplyGlobal() runs in renderAll() right AFTER consolidation and
   BEFORE the manual-parent / manual-detail overrides, so:
     - splits apply to the combined inventory when consolidating, and
     - the manual parents (packages) still layer on top unchanged.
   Per-line value and weight are prorated by quantity so page subtotals stay
   consistent; shipment totals come from the UDQ and are untouched.

   STATE (AppState.itemSplits):
     { enabled: bool,
       splits: { <itemKey>: [ { qty, ship_group }, ... ] } }
   The itemKey is a stable signature of the source line plus an occurrence index,
   so identical lines are disambiguated and a changed inventory simply drops
   stale splits (safe).
   ========================================================================= */

/* ---------------- numeric / formatting helpers ---------------- */

function _siNum(v) {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Quantity display: integers stay integer, else up to 2 decimals. */
function _siFmtQty(n) {
  const r = Math.round((+n + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}

/** Weight display, 2 decimals, trimmed. */
function _siFmtWt(n) {
  const r = Math.round((+n + Number.EPSILON) * 100) / 100;
  return String(r);
}

/* ---------------- item identity ---------------- */

/** Stable signature of a line item (independent of quantity so a split target
 *  keeps matching after it is subdivided is NOT needed — we key the pristine
 *  base, which is never itself split). */
function _siSig(it) {
  // Stable identity independent of quantity / line order, JSON-encoded so any
  // content (newlines, quotes, control chars) is safe. Never placed in the DOM.
  return JSON.stringify([it.model || "", it.desc || "", it.hts || ""]);
}

/** Build the per-render occurrence map + return an ordered list of
 *  { it, key, sig, occ } for the base items. */
function _siEnumerate(items) {
  const occ = {};
  return (items || []).map((it) => {
    const sig = _siSig(it);
    const n = (occ[sig] = (occ[sig] == null ? 0 : occ[sig]));
    occ[sig] = n + 1;
    return { it, sig, occ: n, key: sig + "#" + n };
  });
}

/* ---------------- override builder ---------------- */

/** Rebuild data.items with the splits applied. Never mutates the source. */
function siBuildOverride(base, itemSplits) {
  const splits = (itemSplits && itemSplits.splits) || {};
  const enumd = _siEnumerate(base.items || []);

  const out = [];
  let lineNo = 0;
  for (const rec of enumd) {
    const it = rec.it;
    const parts = splits[rec.key];
    const origQty = _siNum(it.units);
    const usable = (parts || []).filter((p) => _siNum(p.qty) > 0);

    if (usable.length && origQty > 0) {
      const unitVal = _siNum(it.unit_value);
      const lbsPer = origQty ? _siNum(it.weight_lbs) / origQty : 0;
      const kgPer = origQty ? _siNum(it.weight_kg) / origQty : 0;
      // Ship-group-only assignment (one part covering the whole line): keep the
      // line's quantity/value/weight exactly and just set the ship group.
      if (usable.length === 1 && _siNum(usable[0].qty) === origQty) {
        lineNo++;
        const only = Object.assign({}, it, { line: String(lineNo) });
        const g0 = String(usable[0].ship_group || "").trim();
        only.ship_group = g0 || it.ship_group || "";
        out.push(only);
        continue;
      }
      for (const p of usable) {
        const q = _siNum(p.qty);
        lineNo++;
        const clone = Object.assign({}, it);
        clone.line = String(lineNo);
        clone.units = _siFmtQty(q);
        const grp = (p.ship_group != null && String(p.ship_group).trim() !== "")
          ? String(p.ship_group).trim() : (it.ship_group || "");
        clone.ship_group = grp;
        // Prorate value from the unit value (exact); fall back to fractional
        // proration of the line total when no unit value is present.
        if (unitVal) {
          clone.total_value = (typeof fmtMoney === "function") ? fmtMoney(unitVal * q) : String(unitVal * q);
        } else if (origQty) {
          const tv = _siNum(it.total_value) * (q / origQty);
          clone.total_value = (typeof fmtMoney === "function") ? fmtMoney(tv) : String(tv);
        }
        clone.weight_lbs = lbsPer ? _siFmtWt(lbsPer * q) : it.weight_lbs;
        clone.weight_kg = kgPer ? _siFmtWt(kgPer * q) : it.weight_kg;
        clone._split = true;
        out.push(clone);
      }
    } else {
      lineNo++;
      const clone = Object.assign({}, it);
      clone.line = String(lineNo);
      out.push(clone);
    }
  }

  const meta = Object.assign({}, base.meta, { _itemSplit: true });
  return Object.assign({}, base, { meta, items: out });
}

/* ---------------- state / apply ---------------- */

function siReset() {
  if (typeof AppState === "undefined") return;
  AppState.itemSplits = null;
  AppState.siBase = null;
}

/** Any usable split parts entered AND the override enabled. */
function siActive() {
  if (typeof AppState === "undefined" || AppState.udqType !== "srf") return false;
  const si = AppState.itemSplits;
  if (!si || !si.enabled) return false;
  const sp = si.splits || {};
  return Object.keys(sp).some((k) => (sp[k] || []).some((p) => _siNum(p.qty) > 0));
}

function siHasData() {
  const si = (typeof AppState !== "undefined") ? AppState.itemSplits : null;
  if (!si) return false;
  const sp = si.splits || {};
  return Object.keys(sp).some((k) => (sp[k] || []).some((p) => _siNum(p.qty) > 0));
}

/** The pristine (pre-split) base the editor and builder work from. */
function siBase() {
  if (typeof AppState === "undefined") return null;
  const db = AppState.dataBase;
  if (db && !(db.meta && db.meta._itemSplit)) return db;
  return AppState.siBase || db || AppState.data || null;
}

/** Rebuild AppState.dataBase as the split view (or restore the pristine base).
 *  Runs AFTER consolApplyGlobal() and BEFORE mpApplyGlobal() in renderAll(). */
function siApplyGlobal() {
  if (typeof AppState === "undefined" || AppState.udqType !== "srf") return;
  const db = AppState.dataBase;
  if (!db) return;

  // Capture the pre-split base whenever dataBase is NOT already a split view.
  if (!(db.meta && db.meta._itemSplit)) AppState.siBase = db;
  const base = AppState.siBase || db;

  if (!siActive()) {
    if (db.meta && db.meta._itemSplit) { AppState.dataBase = base; AppState.data = base; }
    return;
  }

  const split = siBuildOverride(base, AppState.itemSplits);
  AppState.dataBase = split;
  AppState.data = split;
}

/* ---------------- per-WMTR persistence ---------------- */

const SI_STORE_KEY = "atlas.itemsplits";

function siStoreLoad() {
  try {
    const raw = (typeof localStorage !== "undefined") ? localStorage.getItem(SI_STORE_KEY) : null;
    const o = raw ? JSON.parse(raw) : {};
    return (o && typeof o === "object") ? o : {};
  } catch (e) { return {}; }
}
function siStoreSave(map) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(SI_STORE_KEY, JSON.stringify(map)); return true; }
  catch (e) { return false; }
}
function siCurrentWmtr() {
  const b = siBase();
  return (b && b.meta && b.meta.wmtr) ? String(b.meta.wmtr).trim() : "";
}
function siPersistCurrent() {
  const wmtr = siCurrentWmtr();
  if (!wmtr) return;
  const map = siStoreLoad();
  const si = AppState.itemSplits;
  if (si && siHasData()) {
    map[wmtr] = { enabled: !!si.enabled, splits: si.splits || {}, savedAt: new Date().toISOString() };
  } else {
    delete map[wmtr];
  }
  siStoreSave(map);
}
function siRestoreForWmtr(wmtr) {
  if (!wmtr) return false;
  const e = siStoreLoad()[wmtr];
  if (e && e.splits && Object.keys(e.splits).length) {
    AppState.itemSplits = { enabled: !!e.enabled, splits: e.splits, _restored: true };
    return true;
  }
  return false;
}
function siOnSrfLoaded() {
  if (typeof AppState === "undefined" || AppState.udqType !== "srf") return;
  const wmtr = siCurrentWmtr();
  if (!wmtr) return;
  if (siRestoreForWmtr(wmtr)) {
    if (typeof renderAll === "function") { /* renderAll runs after load */ }
  }
}

/* ---------------- Dialog UI ---------------- */

const SI_STYLE = `
  .si-overlay{position:fixed;inset:0;background:rgba(12,18,28,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1200;padding:5vh 16px;overflow:auto;}
  .si-dialog{background:var(--card);color:inherit;border:1px solid var(--line);border-radius:12px;max-width:760px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.3);}
  .si-dialog header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);}
  .si-dialog header h2{margin:0;font-family:var(--disp);}
  .si-dialog header .x{margin-left:auto;background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:var(--steel);}
  .si-body{padding:14px 18px;max-height:72vh;overflow:auto;}
  .si-intro{font-size:.88rem;color:var(--steel);line-height:1.4;margin:0 0 10px;}
  .si-toggle{display:flex;align-items:center;gap:7px;font-size:.9rem;margin:6px 0 12px;}
  .si-toggle input{width:16px;height:16px;}
  .si-item{border:1px solid var(--line);border-radius:9px;margin:8px 0;overflow:hidden;}
  .si-item-h{display:flex;align-items:center;gap:10px;padding:8px 11px;background:#F5F8FB;cursor:pointer;}
  .si-item-h .d{font-weight:600;color:var(--ink);}
  .si-item-h .m{color:var(--steel);font-size:.82rem;}
  .si-item-h .si-src{font-family:var(--mono);font-size:.7rem;font-weight:500;color:var(--accent-dark);background:#FFF1E8;border:1px solid #F3C9AE;border-radius:4px;padding:1px 6px;letter-spacing:.02em;white-space:nowrap;}
  .si-item-h .q{margin-left:auto;font:600 .8rem var(--disp);color:var(--ink);}
  .si-item-h .split-flag{color:var(--accent);font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;}
  .si-parts{padding:8px 11px;display:none;}
  .si-item.open .si-parts{display:block;}
  .si-part{display:flex;align-items:center;gap:8px;margin:5px 0;}
  .si-part input[type=text]{padding:5px 8px;border:1px solid #B9C4CE;border-radius:6px;font-size:12.5px;background:var(--card);color:var(--ink);}
  .si-part .qty{width:90px;}
  .si-part .grp{width:150px;}
  .si-part .lbl{font-size:.78rem;color:var(--steel);}
  .si-part .rm{margin-left:auto;background:none;border:0;color:var(--warn);cursor:pointer;font-size:.85rem;}
  .si-part-add{font-size:12px;padding:4px 9px;margin-top:4px;}
  .si-rem{font-size:.8rem;margin-top:6px;}
  .si-rem.ok{color:var(--cleared,#2E7D32);}
  .si-rem.bad{color:var(--warn);}
  .si-actions{display:flex;align-items:center;gap:10px;margin:14px 0 2px;flex-wrap:wrap;}
  .si-err{color:var(--warn);font-size:.85rem;min-height:0;margin-top:6px;}
  .si-simple{display:flex;align-items:center;gap:8px;padding:8px 11px;flex-wrap:wrap;}
  .si-simple .grp{width:170px;padding:5px 8px;border:1px solid #B9C4CE;border-radius:6px;font-size:12.5px;background:var(--card);color:var(--ink);}
  .si-simple .btn,.si-partswrap .btn{font-size:12px;padding:5px 9px;}
  .si-partswrap{padding:8px 11px;}
  .si-item-h .grp-flag{color:var(--steel);font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;}
`;

let _siDraft = {};       // key -> parts[] ; a single full-qty part = a whole-line ship group
let _siExpanded = null;  // Set of keys currently showing the split (multi-part) editor
let _siEnabledDraft = false; // live state of the 'use these' checkbox
let _siRecs = [];          // current render's enumerated items (DOM keyed by index)

function closeItemSplit() {
  const o = document.getElementById("siOverlay");
  if (o) o.remove();
  document.removeEventListener("keydown", _siEsc);
}
function _siEsc(e) { if (e.key === "Escape") closeItemSplit(); }

function _siGroupOf(key) {
  const d = _siDraft[key];
  return (d && d[0] && d[0].ship_group != null) ? d[0].ship_group : "";
}
function _siKeyOf(node) {
  const item = node.closest(".si-item");
  const rec = item ? _siRecs[Number(item.getAttribute("data-idx"))] : null;
  return rec ? rec.key : null;
}
function _siIsSplit(key) {
  return (_siExpanded && _siExpanded.has(key)) || !!(_siDraft[key] && _siDraft[key].length > 1);
}

function openItemSplit() {
  if (typeof AppState === "undefined" || AppState.udqType !== "srf") {
    alert("Load an SRF UDQ first — ship groups and splits apply to SRF shipping documents.");
    return;
  }
  const base = siBase();
  const items = (base && base.items) || [];
  if (!items.length) { alert("This UDQ has no inventory line items."); return; }

  closeItemSplit();
  _siExpanded = new Set();

  const si = AppState.itemSplits;
  _siDraft = {};
  if (si && si.splits) for (const k of Object.keys(si.splits)) {
    _siDraft[k] = (si.splits[k] || []).map((pp) => ({ qty: pp.qty, ship_group: pp.ship_group || "" }));
    if (_siDraft[k].length > 1) _siExpanded.add(k);
  }
  const _mpOn = (typeof mpGlobalActive === "function") ? mpGlobalActive() : false;
  _siEnabledDraft = AppState.itemSplits ? !!AppState.itemSplits.enabled
    : (Object.keys(_siDraft).length > 0 || _mpOn);

  const overlay = el(`
    <div class="si-overlay" id="siOverlay">
      <div class="si-dialog" role="dialog" aria-modal="true" aria-label="Line item ship groups and splits">
        <style>${SI_STYLE}</style>
        <header>
          <h2>Ship groups &amp; line splits</h2>
          <button class="x" id="siX" title="Close" aria-label="Close">×</button>
        </header>
        <div class="si-body" id="siBody"></div>
      </div>
    </div>`);
  document.body.appendChild(overlay);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeItemSplit(); });
  overlay.querySelector("#siX").addEventListener("click", closeItemSplit);
  document.addEventListener("keydown", _siEsc);

  _siRenderBody();
}

function _siRenderBody() {
  const body = document.getElementById("siBody");
  if (!body) return;
  const base = siBase();
  const items = (base && base.items) || [];
  const enumd = _siEnumerate(items);
  _siRecs = enumd;

  const itemsHtml = enumd.map((rec, idx) => {
    const it = rec.it;
    const key = rec.key;
    const orig = _siNum(it.units);
    const split = _siIsSplit(key);
    const group = _siGroupOf(key);

    let bodyHtml;
    if (!split) {
      bodyHtml = `
        <div class="si-simple">
          <span class="lbl">Ship group</span>
          <input type="text" class="grp si-grp1" value="${esc(group)}" placeholder="(unassigned)" aria-label="Ship group for this line">
          <button class="btn ghost si-split-open" type="button">Split across pallets…</button>
        </div>`;
    } else {
      const parts = _siDraft[key] || [];
      const partsHtml = parts.map((pp, i) => `
        <div class="si-part" data-i="${i}">
          <span class="lbl">Qty</span>
          <input type="text" class="qty" inputmode="decimal" value="${esc(pp.qty)}" aria-label="Part quantity">
          <span class="lbl">Ship group</span>
          <input type="text" class="grp" value="${esc(pp.ship_group || "")}" placeholder="(optional)" aria-label="Part ship group">
          <button class="rm" type="button" aria-label="Remove part">Remove</button>
        </div>`).join("");
      const sum = parts.reduce((a, pp) => a + _siNum(pp.qty), 0);
      const ok = Math.abs(sum - orig) < 1e-9;
      bodyHtml = `
        <div class="si-partswrap">
          ${partsHtml}
          <button class="btn ghost si-part-add" type="button">+ Add part</button>
          <button class="btn ghost si-split-close" type="button">Use one ship group instead</button>
          <div class="si-rem ${ok ? "ok" : "bad"}">${ok ? `✓ parts total ${_siFmtQty(sum)} = line qty ${_siFmtQty(orig)}` : `Parts total ${_siFmtQty(sum)} — must equal line qty ${_siFmtQty(orig)}`}</div>
        </div>`;
    }

    const flag = split ? `<span class="split-flag">split</span>`
      : (group ? `<span class="grp-flag">grp ${esc(group)}</span>` : "");
    // When the inventory is consolidated from several WMTRs, each line carries the
    // WMTR it came from (tagged in consolBuildCombined) — surface it so the user
    // knows which request a line belongs to while assigning ship groups.
    const src = it.__src_wmtr
      ? `<span class="si-src" title="Line came from this WMTR">WMTR ${esc(it.__src_wmtr)}</span>`
      : "";
    return `
      <div class="si-item" data-idx="${idx}">
        <div class="si-item-h">
          ${src}
          <span class="d">${esc(it.desc) || "(no description)"}</span>
          <span class="m">${esc(it.model || "")}${it.hts ? " · HS " + esc(it.hts) : ""}</span>
          <span class="q">Qty ${esc(it.units || "0")} ${esc(it.uom || "")}</span>
          ${flag}
        </div>
        ${bodyHtml}
      </div>`;
  }).join("");

  body.innerHTML = `
    <p class="si-intro">Assign a <b>ship group</b> to each line to tie it to a manual parent (crate/pallet) on the Packing List. Need part of a line on a different pallet? Use <b>Split across pallets…</b> to divide the quantity. To see items grouped under crates on the Packing List, also define the crates in <b>Edit parent items</b> with matching ship groups. Edits are saved for this WMTR and restored when you reopen it.</p>
    <label class="si-toggle"><input type="checkbox" id="siEnabled" ${_siEnabledDraft ? "checked" : ""}> Use these ship groups / splits on shipping documents</label>
    <div id="siItems">${itemsHtml}</div>
    <div class="si-err" id="siErr"></div>
    <div class="si-actions">
      <button class="btn primary" id="siSave" type="button">Save</button>
      <button class="btn ghost" id="siCancel" type="button">Cancel</button>
    </div>`;

  _siWireBody();
}

function _siReadDraftFromDom() {
  const body = document.getElementById("siBody");
  if (!body) return;
  const _cb = body.querySelector("#siEnabled"); if (_cb) _siEnabledDraft = _cb.checked;
  body.querySelectorAll(".si-item").forEach((el2) => {
    const rec = _siRecs[Number(el2.getAttribute("data-idx"))];
    if (!rec) return;
    const key = rec.key;
    if (_siIsSplit(key)) {
      const parts = [];
      el2.querySelectorAll(".si-part").forEach((row) => {
        parts.push({ qty: row.querySelector(".qty").value, ship_group: row.querySelector(".grp").value });
      });
      if (parts.length) _siDraft[key] = parts; else delete _siDraft[key];
    } else {
      const inp = el2.querySelector(".si-grp1");
      const g = inp ? inp.value.trim() : "";
      const full = _siFmtQty(_siNum(rec.it.units));
      if (g) _siDraft[key] = [{ qty: full, ship_group: g }]; else delete _siDraft[key];
    }
  });
}

function _siWireBody() {
  const body = document.getElementById("siBody");
  if (!body) return;
  const errEl = body.querySelector("#siErr");
  const setErr = (m) => { if (errEl) errEl.textContent = m || ""; };
  const enabledCb = body.querySelector("#siEnabled");
  const base = siBase();
  const byKey = {}; _siEnumerate((base && base.items) || []).forEach((r) => { byKey[r.key] = r.it; });
  const fullQty = (key) => { const it = byKey[key]; return it ? _siNum(it.units) : 0; };

  body.querySelectorAll(".si-grp1").forEach((inp) => {
    inp.addEventListener("change", () => { _siReadDraftFromDom(); _siEnabledDraft = true; _siRenderBody(); });
  });
  const _enCb = body.querySelector("#siEnabled");
  if (_enCb) _enCb.addEventListener("change", () => { _siEnabledDraft = _enCb.checked; });

  body.querySelectorAll(".si-split-open").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = _siKeyOf(btn); if (!key) return;
      _siReadDraftFromDom();
      const g = _siGroupOf(key);
      _siDraft[key] = [{ qty: _siFmtQty(fullQty(key)), ship_group: g || "" }, { qty: "", ship_group: "" }];
      _siExpanded.add(key);
      _siEnabledDraft = true;
      _siRenderBody();
    });
  });

  body.querySelectorAll(".si-split-close").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = _siKeyOf(btn); if (!key) return;
      _siReadDraftFromDom();
      const g = _siGroupOf(key);
      _siExpanded.delete(key);
      if (g) _siDraft[key] = [{ qty: _siFmtQty(fullQty(key)), ship_group: g }]; else delete _siDraft[key];
      _siRenderBody();
    });
  });

  body.querySelectorAll(".si-part-add").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = _siKeyOf(btn); if (!key) return;
      _siReadDraftFromDom();
      (_siDraft[key] = _siDraft[key] || []).push({ qty: "", ship_group: "" });
      _siExpanded.add(key);
      _siEnabledDraft = true;
      _siRenderBody();
    });
  });

  body.querySelectorAll(".si-part .rm").forEach((rm) => {
    rm.addEventListener("click", () => {
      const key = _siKeyOf(rm); if (!key) return;
      const i = Number(rm.closest(".si-part").getAttribute("data-i"));
      _siReadDraftFromDom();
      if (_siDraft[key]) { _siDraft[key].splice(i, 1); if (!_siDraft[key].length) { delete _siDraft[key]; _siExpanded.delete(key); } }
      _siRenderBody();
    });
  });

  body.querySelectorAll(".si-partswrap input").forEach((inp) => {
    inp.addEventListener("input", () => { _siReadDraftFromDom(); _siRefreshRemainders(); });
  });

  body.querySelector("#siSave").addEventListener("click", () => {
    _siReadDraftFromDom();
    setErr("");
    const clean = {};
    for (const key of Object.keys(_siDraft)) {
      const it = byKey[key];
      if (!it) { delete _siDraft[key]; continue; } // stale key from a prior layout — drop, don't block save
      const orig = _siNum(it.units);
      const parts = (_siDraft[key] || []).filter((pp) => String(pp.qty).trim() !== "" || String(pp.ship_group).trim() !== "");
      if (!parts.length) continue;
      if (parts.length === 1 && String(parts[0].qty).trim() === "") parts[0].qty = _siFmtQty(orig);
      if (parts.some((pp) => _siNum(pp.qty) <= 0)) {
        setErr(`A quantity for "${it ? (it.desc || it.model) : key}" is zero or blank.`); return;
      }
      const sum = parts.reduce((a, pp) => a + _siNum(pp.qty), 0);
      if (Math.abs(sum - orig) > 1e-9) {
        setErr(`Quantities for "${it ? (it.desc || it.model) : key}" total ${_siFmtQty(sum)} but the line quantity is ${_siFmtQty(orig)}.`); return;
      }
      clean[key] = parts.map((pp) => ({ qty: _siNum(pp.qty), ship_group: String(pp.ship_group || "").trim() }));
    }
    const enabled = !!(enabledCb && enabledCb.checked);
    AppState.itemSplits = { enabled, splits: clean };
    if (typeof siPersistCurrent === "function") siPersistCurrent();
    // Assigning ship groups is only meaningful if the Packing List groups by
    // them — so if parent crates are defined, turn the manual parents on.
    if (Object.keys(clean).length && typeof mpHasRows === "function" && mpHasRows() &&
        typeof AppState.manualParents === "object" && AppState.manualParents) {
      AppState.manualParents.enabled = true;
      if (typeof mpPersistCurrent === "function") mpPersistCurrent();
    }
    closeItemSplit();
    if (typeof renderAll === "function") renderAll();
    const status = document.getElementById("loadStatus");
    if (status) {
      const n = Object.keys(clean).length;
      status.textContent = n ? `Ship groups / splits ${enabled ? "ON" : "saved (off)"} — ${n} line${n === 1 ? "" : "s"} set.` : "No ship groups or splits saved.";
      status.classList.remove("err");
    }
    if (typeof atlasAnnounce === "function") { try { atlasAnnounce(enabled ? "Ship groups applied." : "Ship groups saved."); } catch (e) {} }
  });
  body.querySelector("#siCancel").addEventListener("click", closeItemSplit);
}

function _siRefreshRemainders() {
  document.querySelectorAll(".si-item").forEach((item) => {
    const rec = _siRecs[Number(item.getAttribute("data-idx"))];
    if (!rec) return;
    const key = rec.key;
    const rem = item.querySelector(".si-rem");
    if (!rem) return;
    const parts = _siDraft[key];
    if (!parts || !parts.length) { rem.textContent = ""; rem.className = "si-rem"; return; }
    const orig = _siNum(rec.it.units);
    const sum = parts.reduce((a, pp) => a + _siNum(pp.qty), 0);
    const ok = Math.abs(sum - orig) < 1e-9;
    rem.className = "si-rem " + (ok ? "ok" : "bad");
    rem.textContent = ok ? `✓ parts total ${_siFmtQty(sum)} = line qty ${_siFmtQty(orig)}` : `Parts total ${_siFmtQty(sum)} — must equal line qty ${_siFmtQty(orig)}`;
  });
}

/* Node/tooling guard (no-op in the browser). */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    siBuildOverride, siApplyGlobal, siActive, siHasData, siReset, siBase,
    _siEnumerate, _siSig, _siNum,
  };
}
