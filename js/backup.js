/* =========================================================================
   ATLAS Utility Web — backup.js
   Settings & data backup / restore (Feature #1).

   Exports everything the app keeps in localStorage — settings, editable
   reference data (custom signers + forwarders), run history, recent UDQs and
   the chosen theme — into a single portable JSON file, and re-imports it.

   WHY: localStorage is per-browser with no backend, so reference data a team
   curates (custom signers, freight forwarders, default contract/purpose, the
   validation-gate config) lives only on one machine. A backup file makes that
   durable across reinstalls/new machines and lets one person share a curated
   set with teammates — without standing up a server.

   CAVEAT (surface this to the user): there is still no backend. A backup is a
   point-in-time file; it is not a live sync. Two people editing reference data
   will not see each other's changes until someone re-exports and re-imports.

   What is NOT exported: the per-UDQ "form cache" (atlas.formcache.*). Those are
   transient, shipment-specific in-progress inputs — not reference data and not
   meaningful to move between machines or share. Everything else under the
   "atlas." namespace is included.
   ========================================================================= */

/* Keys we back up, in a stable order. The theme is a bare string; the rest are
   JSON. We deliberately exclude the FormCache PREFIX ("atlas.formcache."). */
const ATLAS_BACKUP_SPEC = [
  { key: "atlas.settings", kind: "json",   label: "Settings & reference data" },
  { key: "atlas.history",  kind: "json",   label: "Run history" },
  { key: "atlas.recents",  kind: "json",   label: "Recent UDQs" },
  { key: "atlas.parents",  kind: "json",   label: "Saved manual parent items" },
  { key: "atlas.shipdetails", kind: "json", label: "Saved manual shipping details" },
  { key: "atlas.theme",    kind: "string", label: "Appearance" },
];

const ATLAS_BACKUP_MARK = "atlas-backup";
const ATLAS_BACKUP_SCHEMA = 1;

/* ---- storage shims so the core functions are unit-testable in Node ---- */
function _bkGet(key) {
  try { return (typeof localStorage !== "undefined") ? localStorage.getItem(key) : null; }
  catch (e) { return null; }
}
function _bkSet(key, val) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(key, val); return true; }
  catch (e) { return false; }
}

/* =========================================================================
   Gather / build  (pure-ish: only reads storage)
   ========================================================================= */

/** Collect the backed-up keys into a plain object. JSON values are parsed so
 *  the file is human-readable & editable; unparseable values fall back to the
 *  raw string. Missing keys are simply omitted. */
function atlasGatherBackup() {
  const data = {};
  for (const spec of ATLAS_BACKUP_SPEC) {
    const raw = _bkGet(spec.key);
    if (raw == null) continue;
    if (spec.kind === "json") {
      try { data[spec.key] = JSON.parse(raw); }
      catch (e) { data[spec.key] = raw; } // keep something rather than lose it
    } else {
      data[spec.key] = raw;
    }
  }
  return data;
}

/** Build the full backup envelope object. */
function atlasBuildBackup() {
  return {
    app: (typeof APP_NAME !== "undefined" ? APP_NAME : "ATLAS Utility") + " Web",
    kind: ATLAS_BACKUP_MARK,
    schema: ATLAS_BACKUP_SCHEMA,
    version: (typeof APP_VERSION !== "undefined" ? APP_VERSION : ""),
    exportedAt: new Date().toISOString(),
    data: atlasGatherBackup(),
  };
}

/** Pretty-printed JSON string for the download. */
function atlasBuildBackupJson() {
  return JSON.stringify(atlasBuildBackup(), null, 2);
}

/* =========================================================================
   Validate / summarize
   ========================================================================= */

/** Confirm an imported object looks like one of our backups and describe it.
 *  Returns { ok, reason, summary } where summary is a list of human strings. */
function atlasValidateBackup(obj) {
  if (!obj || typeof obj !== "object") {
    return { ok: false, reason: "That file isn't valid JSON.", summary: [] };
  }
  if (obj.kind !== ATLAS_BACKUP_MARK || !obj.data || typeof obj.data !== "object") {
    return { ok: false, reason: "This doesn't look like an ATLAS backup file.", summary: [] };
  }
  if (typeof obj.schema === "number" && obj.schema > ATLAS_BACKUP_SCHEMA) {
    return {
      ok: false,
      reason: `This backup was made by a newer version (schema ${obj.schema}). Update ATLAS, then import again.`,
      summary: [],
    };
  }
  const summary = [];
  const s = obj.data["atlas.settings"];
  if (s && typeof s === "object") {
    const sg = Array.isArray(s.customSigners) ? s.customSigners.length : 0;
    const fw = Array.isArray(s.customForwarders) ? s.customForwarders.length : 0;
    const vn = Array.isArray(s.customVendors) ? s.customVendors.length : 0;
    summary.push(`Settings (${sg} custom signer${sg === 1 ? "" : "s"}, ${fw} forwarder${fw === 1 ? "" : "s"}, ${vn} vendor${vn === 1 ? "" : "s"})`);
  }
  const hist = obj.data["atlas.history"];
  if (Array.isArray(hist)) summary.push(`${hist.length} history entr${hist.length === 1 ? "y" : "ies"}`);
  const rec = obj.data["atlas.recents"];
  if (Array.isArray(rec)) summary.push(`${rec.length} recent UDQ${rec.length === 1 ? "" : "s"}`);
  if (typeof obj.data["atlas.theme"] === "string") summary.push("appearance preference");
  return { ok: true, reason: "", summary };
}

/* =========================================================================
   Merge helpers (pure — exported for tests)
   ========================================================================= */

/** Dedupe-append two arrays of records by a key function (incoming wins on
 *  collision, existing order preserved, new items appended). */
function atlasMergeByKey(existing, incoming, keyFn) {
  const out = Array.isArray(existing) ? existing.slice() : [];
  const idx = new Map();
  out.forEach((e, i) => idx.set(keyFn(e), i));
  for (const item of (Array.isArray(incoming) ? incoming : [])) {
    const k = keyFn(item);
    if (idx.has(k)) out[idx.get(k)] = item;       // update in place
    else { idx.set(k, out.length); out.push(item); } // append
  }
  return out;
}

/** Merge an incoming settings object into the current one:
 *  - scalar prefs: incoming overrides (it's the explicit import)
 *  - customSigners / customForwarders: union by name (case-insensitive) */
function atlasMergeSettings(current, incoming) {
  const cur = (current && typeof current === "object") ? current : {};
  const inc = (incoming && typeof incoming === "object") ? incoming : {};
  const merged = Object.assign({}, cur, inc);
  const nameKey = (r) => String((r && r.name) || "").trim().toLowerCase();
  merged.customSigners = atlasMergeByKey(cur.customSigners, inc.customSigners, nameKey)
    .filter((r) => r && String(r.name || "").trim());
  merged.customForwarders = atlasMergeByKey(cur.customForwarders, inc.customForwarders, nameKey)
    .filter((r) => r && String(r.name || "").trim());
  merged.customVendors = atlasMergeByKey(cur.customVendors, inc.customVendors, nameKey)
    .filter((r) => r && String(r.name || "").trim());
  return merged;
}

/* =========================================================================
   Apply  (writes storage)
   ========================================================================= */

/** Write an imported backup to localStorage.
 *  mode = "replace": overwrite each included key with the file's value.
 *  mode = "merge":   union reference data + append history/recents; keep theme.
 *  Returns { ok, applied: [keys] }. Does not reload globals — caller does. */
function atlasApplyBackup(obj, mode) {
  const v = atlasValidateBackup(obj);
  if (!v.ok) return { ok: false, reason: v.reason, applied: [] };
  const data = obj.data;
  const applied = [];

  const writeJson = (key, val) => { if (_bkSet(key, JSON.stringify(val))) applied.push(key); };

  if (mode === "merge") {
    if ("atlas.settings" in data) {
      let cur = {};
      try { cur = JSON.parse(_bkGet("atlas.settings") || "{}") || {}; } catch (e) { cur = {}; }
      writeJson("atlas.settings", atlasMergeSettings(cur, data["atlas.settings"]));
    }
    if (Array.isArray(data["atlas.history"])) {
      let cur = [];
      try { cur = JSON.parse(_bkGet("atlas.history") || "[]") || []; } catch (e) { cur = []; }
      // history rows have a ts + filename; dedupe on that pair
      const key = (e) => String((e && e.ts) || "") + "|" + String((e && e.filename) || "");
      writeJson("atlas.history", atlasMergeByKey(cur, data["atlas.history"], key));
    }
    if (Array.isArray(data["atlas.recents"])) {
      let cur = [];
      try { cur = JSON.parse(_bkGet("atlas.recents") || "[]") || []; } catch (e) { cur = []; }
      const key = (e) => String((e && e.wmtr) || (e && e.fileName) || "") + "|" + String((e && e.udqType) || "");
      writeJson("atlas.recents", atlasMergeByKey(cur, data["atlas.recents"], key));
    }
    if (data["atlas.parents"] && typeof data["atlas.parents"] === "object") {
      let cur = {};
      try { cur = JSON.parse(_bkGet("atlas.parents") || "{}") || {}; } catch (e) { cur = {}; }
      // merge per-WMTR; imported entries win on conflict
      writeJson("atlas.parents", Object.assign({}, cur, data["atlas.parents"]));
    }
    if (data["atlas.shipdetails"] && typeof data["atlas.shipdetails"] === "object") {
      let cur = {};
      try { cur = JSON.parse(_bkGet("atlas.shipdetails") || "{}") || {}; } catch (e) { cur = {}; }
      // merge per-WMTR; imported entries win on conflict
      writeJson("atlas.shipdetails", Object.assign({}, cur, data["atlas.shipdetails"]));
    }
    // theme intentionally left as-is on merge (it's a device preference)
  } else {
    // replace
    for (const spec of ATLAS_BACKUP_SPEC) {
      if (!(spec.key in data)) continue;
      const val = data[spec.key];
      if (spec.kind === "json") writeJson(spec.key, val);
      else if (_bkSet(spec.key, String(val))) applied.push(spec.key);
    }
  }
  return { ok: true, applied };
}

/* =========================================================================
   Browser glue: download, file read, confirm modal
   ========================================================================= */

function atlasBackupFilename() {
  const stamp = (typeof fileStamp === "function") ? fileStamp() : Date.now();
  return `ATLAS_Backup_${stamp}.json`;
}

/** Trigger a download of the current backup. Reuses the app's audit-skip
 *  anchor convention so the export isn't logged as a document. */
function atlasExportBackupDownload() {
  const text = atlasBuildBackupJson();
  const a = document.createElement("a");
  a.href = "data:application/json;charset=utf-8," + encodeURIComponent(text);
  a.download = atlasBackupFilename();
  a.dataset.auditSkip = "1";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 500);
}

const BACKUP_STYLE = `
  .bk-overlay{position:fixed;inset:0;background:rgba(12,18,28,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1100;padding:8vh 16px;overflow:auto;}
  .bk-dialog{background:var(--card);color:inherit;border:1px solid var(--line);border-radius:12px;max-width:460px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.3);}
  .bk-dialog header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);}
  .bk-dialog header h2{margin:0;font:600 1.05rem var(--disp);}
  .bk-dialog header .x{margin-left:auto;background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:var(--steel);}
  .bk-body{padding:16px 18px;}
  .bk-body p{margin:0 0 10px;}
  .bk-list{margin:8px 0 12px;padding-left:18px;color:var(--steel);font-size:.9rem;}
  .bk-list li{margin:2px 0;}
  .bk-err{color:var(--warn,#b32424);font-weight:600;}
  .bk-foot{display:flex;align-items:center;gap:10px;padding:14px 18px;border-top:1px solid var(--line);flex-wrap:wrap;}
  .bk-foot .spacer{margin-left:auto;}
  .bk-warn{font-size:.82rem;color:var(--steel);margin-top:6px;}
`;

function _atlasBackupCloseModal() {
  const o = document.getElementById("bkOverlay");
  if (o) o.remove();
  document.removeEventListener("keydown", _atlasBackupEsc);
}
function _atlasBackupEsc(e) { if (e.key === "Escape") _atlasBackupCloseModal(); }

/** Open the import confirmation modal for a parsed/validated backup object. */
function _atlasBackupConfirmImport(obj) {
  const v = atlasValidateBackup(obj);
  _atlasBackupCloseModal();

  const bodyHtml = v.ok
    ? `<p>This backup contains:</p>
       <ul class="bk-list">${v.summary.map((s) => `<li>${esc(s)}</li>`).join("") || "<li>(nothing recognizable)</li>"}</ul>
       <p>Choose how to apply it:</p>
       <p class="bk-warn"><strong>Replace</strong> overwrites your settings, reference data, history and recents
       with the file's contents. <strong>Merge</strong> adds the file's custom signers and forwarders to yours
       (matching names are updated) and appends history/recents, keeping your current preferences and appearance.</p>`
    : `<p class="bk-err">${esc(v.reason)}</p>`;

  const footHtml = v.ok
    ? `<button class="btn ghost" id="bkCancel" type="button">Cancel</button>
       <span class="spacer"></span>
       <button class="btn ghost" id="bkMerge" type="button">Merge</button>
       <button class="btn primary" id="bkReplace" type="button">Replace</button>`
    : `<span class="spacer"></span><button class="btn primary" id="bkCancel" type="button">Close</button>`;

  const overlay = el(`
    <div class="bk-overlay" id="bkOverlay">
      <div class="bk-dialog" role="dialog" aria-modal="true" aria-label="Import backup">
        <style>${BACKUP_STYLE}</style>
        <header><h2>Import backup</h2><button class="x" id="bkX" title="Close" aria-label="Close">×</button></header>
        <div class="bk-body">${bodyHtml}</div>
        <div class="bk-foot">${footHtml}</div>
      </div>
    </div>`);
  document.body.appendChild(overlay);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) _atlasBackupCloseModal(); });
  overlay.querySelector("#bkX").addEventListener("click", _atlasBackupCloseModal);
  const cancel = overlay.querySelector("#bkCancel");
  if (cancel) cancel.addEventListener("click", _atlasBackupCloseModal);
  document.addEventListener("keydown", _atlasBackupEsc);

  const doApply = (mode) => {
    const r = atlasApplyBackup(obj, mode);
    _atlasBackupCloseModal();
    if (!r.ok) { alert(r.reason || "Import failed."); return; }
    _atlasBackupAfterImport();
  };
  const mergeBtn = overlay.querySelector("#bkMerge");
  const replaceBtn = overlay.querySelector("#bkReplace");
  if (mergeBtn) mergeBtn.addEventListener("click", () => doApply("merge"));
  if (replaceBtn) replaceBtn.addEventListener("click", () => doApply("replace"));
}

/** Refresh in-memory state after an import so the app reflects new data without
 *  a manual reload. */
function _atlasBackupAfterImport() {
  try {
    if (typeof AtlasSettings !== "undefined") AtlasSettings._data = null; // force reload from storage
    if (typeof applyReferenceData === "function") applyReferenceData();
    if (typeof loadSavedTheme === "function") loadSavedTheme();
    if (typeof recentsRender === "function") recentsRender();
    if (typeof renderAll === "function") renderAll();
    if (typeof closeSettings === "function") closeSettings();
  } catch (e) { /* non-fatal */ }
  alert("Backup imported.");
}

/** Read a File (from an <input type=file>) and start the import flow. */
function atlasImportBackupFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let obj = null;
    try { obj = JSON.parse(String(reader.result || "")); }
    catch (e) { _atlasBackupConfirmImport(null); return; }
    _atlasBackupConfirmImport(obj);
  };
  reader.onerror = () => _atlasBackupConfirmImport(null);
  reader.readAsText(file);
}

/* ---------- Node test support ---------- */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ATLAS_BACKUP_SPEC, ATLAS_BACKUP_MARK, ATLAS_BACKUP_SCHEMA,
    atlasGatherBackup, atlasBuildBackup, atlasBuildBackupJson,
    atlasValidateBackup, atlasMergeByKey, atlasMergeSettings, atlasApplyBackup,
  };
}
