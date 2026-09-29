/* =========================================================================
   ATLAS Utility Web — formcache.js
   Auto-save in-progress tool form inputs (Feature: prevents lost work).

   Values are namespaced by UDQ identity (WMTR) + tool id, so what you typed for
   one shipment never bleeds into another. Saved on edit (debounced), restored
   when a tool re-renders (switching tools, or re-dropping the same UDQ after a
   reload). Controlled by Settings ▸ General ▸ "Auto-save in-progress form
   inputs" (default on). Per-browser localStorage, same as the rest of the app.

   Only fields the user actually CHANGED are restored, and date fields are never
   remembered (they always start at the tool's normal default, e.g. today).
   Every restored value that differs from what the tool would otherwise fill in
   (the UDQ value or the form default) is flagged loudly — a yellow outline on
   the field plus a "FROM MEMORY" banner at the top of the tool listing each one
   next to the UDQ value, with one-click "Use UDQ value" — so a remembered value
   is never mistaken for UDQ data just because it's easy to miss in the preview.
   ========================================================================= */
const FormCache = {
  PREFIX: "atlas.formcache.",

  enabled() {
    try {
      if (typeof AtlasSettings === "undefined") return true;
      return AtlasSettings.get().autoSaveForms !== false;
    } catch (e) { return true; }
  },

  _udqKey() {
    if (typeof AppState === "undefined") return "";
    // The pristine WMTR (dataBase), not AppState.data — a manual override can
    // change data.meta.wmtr, which would strand everything typed so far.
    const b = AppState.dataBase || AppState.data;
    const m = (b && b.meta) || {};
    // Manual entry without a WMTR yet: no stable identity, so don't cache —
    // otherwise every such entry would share (and restore) one set of values.
    if (AppState.manualOnly && !m.wmtr) return "";
    return String(m.wmtr || m.wmtr_last5 || AppState.fileName || "");
  },

  /** Fields never remembered: files, passwords, dates (always the normal
   *  default, e.g. today), and anything marked data-fc-skip (e.g. the signer). */
  _skip(el) {
    return el.type === "file" || el.type === "password" || el.type === "date" ||
      el.hasAttribute("data-fc-skip");
  },

  // Each field's value as the tool rendered it (before restore). A cached value
  // equal to the default it had then was never edited — restoring it would put
  // back a stale prefill (e.g. a consignee block since corrected by a manual
  // override), so restore skips it and the fresh default stands.
  _defaults: {},
  snapshotDefaults() {
    this._defaults = {};
    const ws = document.getElementById("workspace");
    if (!ws) return;
    ws.querySelectorAll("input[id], select[id], textarea[id]").forEach((el) => {
      if (this._skip(el)) return;
      this._defaults[el.id] = (el.type === "checkbox" || el.type === "radio") ? { c: el.checked } : { v: el.value };
    });
  },
  _key(tool) { return this.PREFIX + this._udqKey() + "." + tool; },

  save(tool) {
    if (!this.enabled() || !tool) return;
    const udq = this._udqKey();
    if (!udq) return;
    const ws = document.getElementById("workspace");
    if (!ws) return;
    const data = {};
    ws.querySelectorAll("input[id], select[id], textarea[id]").forEach((el) => {
      if (this._skip(el)) return;
      const def = this._defaults[el.id];
      if (el.type === "checkbox" || el.type === "radio") {
        data[el.id] = { c: el.checked };
        if (def && def.c !== undefined) data[el.id].dc = def.c;
      } else {
        data[el.id] = { v: el.value };
        if (def && def.v !== undefined) data[el.id].d = def.v;
      }
    });
    try { localStorage.setItem(this._key(tool), JSON.stringify(data)); } catch (e) { /* storage off */ }
  },

  /** Restore remembered values. Returns the fields now showing a remembered
   *  value that differs from this render's default: [{ el, def }]. */
  restore(tool) {
    const flagged = [];
    if (!this.enabled() || !tool) return flagged;
    if (!this._udqKey()) return flagged;
    let data = null;
    try { data = JSON.parse(localStorage.getItem(this._key(tool)) || "null"); } catch (e) { data = null; }
    if (!data) return flagged;
    const ws = document.getElementById("workspace");
    if (!ws) return flagged;
    Object.keys(data).forEach((id) => {
      const el = document.getElementById(id);
      if (!el || !ws.contains(el)) return;
      if (this._skip(el)) return;      // never restore skipped fields (signer, dates)
      const rec = data[id];
      // Unedited when saved (still its rendered default) → keep today's default.
      if (rec.d !== undefined && rec.v === rec.d) return;
      if (rec.dc !== undefined && rec.c === rec.dc) return;
      const def = this._defaults[id];
      if (rec.c !== undefined && (el.type === "checkbox" || el.type === "radio")) {
        el.checked = !!rec.c;
        _fcFire(el, "change");
        if (def && def.c !== undefined && el.checked !== def.c) flagged.push({ el, def });
      } else if (rec.v !== undefined && el.value !== undefined) {
        // Don't let a previously-cached EMPTY value clobber a freshly-computed
        // default already in the field (e.g. the CI "Shipment Comments" CTR/DTRA
        // auto-fill, or "Shipment Ref No" from AWB/BoL). Apply an empty cached
        // value only when the live field is also empty; non-empty saved edits
        // still take precedence so genuine in-progress work is preserved.
        if (rec.v === "" && String(el.value || "") !== "") {
          /* keep the rendered default */
        } else {
          el.value = rec.v;
          _fcFire(el, el.tagName === "SELECT" ? "change" : "input");
          if (def && def.v !== undefined && el.value !== def.v) flagged.push({ el, def });
        }
      }
    });
    return flagged;
  },

  purgeAll() {
    try {
      const kill = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(this.PREFIX) === 0) kill.push(k);
      }
      kill.forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }
  },
};

function _fcFire(el, type) {
  try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch (e) { /* ignore */ }
}

let _fcRestoring = false;

function formcacheInit() {
  const ws = document.getElementById("workspace");
  if (!ws || ws._fcInit) return;
  ws._fcInit = true;
  let t = null;
  const onEdit = (e) => {
    if (_fcRestoring) return;
    // The user took this field over — it's their current value now, not memory.
    // (Never let flag bookkeeping stop the save below.)
    try {
      if (e && e.target && e.target.classList && e.target.classList.contains("fc-mem-field")) _fcUnflag(e.target);
    } catch (err) { /* ignore */ }
    const tool = (typeof AppState !== "undefined") && AppState.activeTool;
    if (!tool) return;
    clearTimeout(t);
    t = setTimeout(() => FormCache.save(tool), 250);
  };
  ws.addEventListener("input", onEdit);
  ws.addEventListener("change", onEdit);
}

/** Called at the end of renderWorkspace, after a tool has rendered. */
function formcacheOnRender() {
  formcacheInit();
  const tool = (typeof AppState !== "undefined") && AppState.activeTool;
  if (!tool) return;
  FormCache.snapshotDefaults();   // before restore: the values this render produced
  _fcRestoring = true;
  let flagged = [];
  try { flagged = FormCache.restore(tool); } finally { setTimeout(() => { _fcRestoring = false; }, 0); }
  _fcShowMemory(flagged);
}

/* =========================================================================
   "FROM MEMORY" flags — field outline + banner at the top of the tool
   ========================================================================= */

function _fcEnsureStyle() {
  if (document.getElementById("fcMemStyle")) return;
  const s = document.createElement("style");
  s.id = "fcMemStyle";
  s.textContent = `
  .fc-mem-field{outline:2px solid var(--mx-warn-bd) !important;outline-offset:1px;background:var(--mx-warn-bg) !important;}
  .fc-mem-banner{margin:0 0 14px;padding:11px 14px;border:1px solid var(--mx-warn-bd);border-left:6px solid var(--mx-warn-bd);
    border-radius:9px;background:var(--mx-warn-bg);color:var(--mx-warn-fg);}
  .fc-mem-banner .fc-mem-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
  .fc-mem-banner .fc-mem-badge{font:700 .72rem var(--disp);letter-spacing:.06em;background:var(--mx-warn-bd);color:#3a2c00;border-radius:6px;padding:3px 9px;flex:0 0 auto;}
  .fc-mem-banner .fc-mem-title{font-size:.92rem;font-weight:600;flex:1 1 260px;color:var(--mx-warn-fg);}
  .fc-mem-banner table{width:100%;border-collapse:collapse;margin:9px 0 4px;font-size:.84rem;}
  .fc-mem-banner th{text-align:left;font:600 .66rem var(--disp);letter-spacing:.05em;text-transform:uppercase;padding:3px 6px;border-bottom:1px solid var(--mx-warn-bd);}
  .fc-mem-banner td{padding:4px 6px;border-bottom:1px dashed var(--mx-warn-bd);vertical-align:top;color:var(--ink);}
  .fc-mem-banner td.v{font-family:var(--mono);font-size:.8rem;word-break:break-word;}
  .fc-mem-banner td.lbl{font-weight:600;}
  .fc-mem-banner .fc-mem-hint{font-size:.8rem;margin-top:4px;}
  .fc-mem-banner .btn{font-size:12px;padding:5px 10px;}
  `;
  document.head.appendChild(s);
}

/** The field's on-screen label (label[for], wrapping label, aria-label, else id). */
function _fcLabel(el) {
  let t = "";
  try {
    const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`) || el.closest("label");
    if (l) t = l.textContent;
  } catch (e) { /* ignore */ }
  t = String(t || el.getAttribute("aria-label") || el.id).replace(/\s+/g, " ").trim().replace(/[:*]+$/, "");
  return t.length > 60 ? t.slice(0, 57) + "…" : t;
}

/** A value as the user sees it: option text for selects, On/Off for checkboxes. */
function _fcShow(el, val, checked) {
  let s;
  if (el.type === "checkbox" || el.type === "radio") s = checked ? "On (ticked)" : "Off (not ticked)";
  else if (el.tagName === "SELECT") {
    const o = Array.from(el.options).find((x) => x.value === val);
    s = o ? o.textContent : val;
  } else s = val;
  s = String(s == null ? "" : s).replace(/\s*\n\s*/g, " / ").trim();
  if (!s) return "(blank)";
  return s.length > 140 ? s.slice(0, 137) + "…" : s;
}

let _fcFlagged = [];   // [{ el, def }] currently flagged in the open tool

function _fcShowMemory(flagged) {
  _fcFlagged = (flagged || []).filter((f) => f && f.el && document.body.contains(f.el));
  document.querySelectorAll("#fcMemBanner").forEach((b) => b.remove());
  if (!_fcFlagged.length) return;
  _fcEnsureStyle();

  const rows = _fcFlagged.map((f, i) => {
    const el = f.el;
    el.classList.add("fc-mem-field");
    const udq = (el.type === "checkbox" || el.type === "radio")
      ? _fcShow(el, "", f.def.c) : _fcShow(el, f.def.v);
    const mem = (el.type === "checkbox" || el.type === "radio")
      ? _fcShow(el, "", el.checked) : _fcShow(el, el.value);
    if (el.dataset.fcTitle === undefined) el.dataset.fcTitle = el.getAttribute("title") || "";
    el.title = `Filled from memory (your earlier edit). The UDQ / form default is: ${udq}`;
    return `<tr data-fc-row="${i}">
        <td class="lbl">${esc(_fcLabel(el))}</td>
        <td class="v">${esc(mem)}</td>
        <td class="v">${esc(udq)}</td>
        <td><button class="btn ghost" type="button" data-fc-revert="${i}">Use UDQ value</button></td>
      </tr>`;
  }).join("");

  const n = _fcFlagged.length;
  const banner = el(`
    <div class="fc-mem-banner" id="fcMemBanner" role="status">
      <div class="fc-mem-head">
        <span class="fc-mem-badge">FROM MEMORY</span>
        <span class="fc-mem-title">${n} field${n === 1 ? " is" : "s are"} filled in from your earlier edits and
          ${n === 1 ? "doesn't" : "don't"} match the UDQ. Check ${n === 1 ? "it" : "them"} before you generate.</span>
        ${n > 1 ? `<button class="btn ghost" type="button" id="fcMemAll">Use UDQ values for all</button>` : ""}
      </div>
      <table>
        <thead><tr><th>Field</th><th>Remembered (in use)</th><th>UDQ / form default</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="fc-mem-hint">These fields are outlined in yellow below. Editing one keeps your value and clears its flag.</div>
    </div>`);

  banner.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-fc-revert]");
    if (b) { _fcRevert(_fcFlagged[Number(b.getAttribute("data-fc-revert"))]); return; }
    if (e.target.id === "fcMemAll") _fcFlagged.slice().forEach((f) => _fcRevert(f));
  });

  const ws = document.getElementById("workspace");
  const host = (ws && (ws.querySelector(":scope > .panel > .body") || ws.querySelector(":scope > .panel"))) || ws;
  if (host) host.insertBefore(banner, host.firstChild);
}

/** Put a flagged field back to its UDQ / form default (saved like a normal edit). */
function _fcRevert(f) {
  if (!f || !f.el) return;
  const el = f.el;
  if (el.type === "checkbox" || el.type === "radio") {
    el.checked = !!f.def.c;
    _fcFire(el, "change");
  } else {
    el.value = f.def.v;
    _fcFire(el, el.tagName === "SELECT" ? "change" : "input");
  }
  _fcUnflag(el);
}

/** Clear one field's flag; drop its banner row, and the banner when none are left. */
function _fcUnflag(el) {
  el.classList.remove("fc-mem-field");
  if (el.dataset.fcTitle !== undefined) {           // put back the field's own tooltip
    if (el.dataset.fcTitle) el.title = el.dataset.fcTitle; else el.removeAttribute("title");
    delete el.dataset.fcTitle;
  }
  const i = _fcFlagged.findIndex((f) => f && f.el === el);   // cleared rows are null
  if (i === -1) return;
  const row = document.querySelector(`#fcMemBanner tr[data-fc-row="${i}"]`);
  if (row) row.remove();
  _fcFlagged[i] = null;
  if (!_fcFlagged.some(Boolean)) {
    const b = document.getElementById("fcMemBanner");
    if (b) b.remove();
    _fcFlagged = [];
  }
}
