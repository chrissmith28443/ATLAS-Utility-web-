/* =========================================================================
   ATLAS Utility Web — formcache.js
   Auto-save in-progress tool form inputs (Feature: prevents lost work).

   Values are namespaced by UDQ identity (WMTR) + tool id, so what you typed for
   one shipment never bleeds into another. Saved on edit (debounced), restored
   when a tool re-renders (switching tools, or re-dropping the same UDQ after a
   reload). Controlled by Settings ▸ General ▸ "Auto-save in-progress form
   inputs" (default on). Per-browser localStorage, same as the rest of the app.
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
    const m = (AppState.data && AppState.data.meta) || {};
    return String(m.wmtr || m.wmtr_last5 || AppState.fileName || "");
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
      if (el.type === "file" || el.type === "password") return;
      // Fields marked data-fc-skip are intentionally NOT remembered as
      // "last used" — e.g. the signer, which must always follow the Settings
      // default signer rather than reverting to whoever signed last.
      if (el.hasAttribute("data-fc-skip")) return;
      if (el.type === "checkbox" || el.type === "radio") data[el.id] = { c: el.checked };
      else data[el.id] = { v: el.value };
    });
    try { localStorage.setItem(this._key(tool), JSON.stringify(data)); } catch (e) { /* storage off */ }
  },

  restore(tool) {
    if (!this.enabled() || !tool) return;
    if (!this._udqKey()) return;
    let data = null;
    try { data = JSON.parse(localStorage.getItem(this._key(tool)) || "null"); } catch (e) { data = null; }
    if (!data) return;
    const ws = document.getElementById("workspace");
    if (!ws) return;
    Object.keys(data).forEach((id) => {
      const el = document.getElementById(id);
      if (!el || !ws.contains(el)) return;
      if (el.hasAttribute("data-fc-skip")) return; // never restore skipped fields (e.g. signer)
      const rec = data[id];
      if (rec.c !== undefined && (el.type === "checkbox" || el.type === "radio")) {
        el.checked = !!rec.c;
        _fcFire(el, "change");
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
          _fcFire(el, (el.tagName === "SELECT" || el.type === "date") ? "change" : "input");
        }
      }
    });
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
  const onEdit = () => {
    if (_fcRestoring) return;
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
  _fcRestoring = true;
  try { FormCache.restore(tool); } finally { setTimeout(() => { _fcRestoring = false; }, 0); }
}
