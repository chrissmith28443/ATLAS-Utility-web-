/* =========================================================================
   ATLAS Utility Web — tools/manual_details.js

   Manual override for fixed shipping-document details (Commercial Invoice +
   Placards, and any other document that reads these fields).

   WHY THIS EXISTS
   ----------------
   Some header-level shipment details — payment terms, IncoTerms, and the
   point-of-contact phone/email for each party — are sometimes corrected AFTER
   Compliance Review and can no longer be edited in ATLAS, so the UDQ export
   carries stale values. This lets the user overwrite those specific fields with
   manual data for the purposes of shipping paperwork, exactly like the manual
   parent-items override does for package counts/weights.

   WHICH FIELDS
   ------------
     • Payment Terms              → meta.payment_terms      (CI)
     • Payment Terms Remarks      → meta.payment_terms_remarks (CI)
     • IncoTerms                  → meta.incoterm           (CI)

   Per party (each overrides parties[partyKey].addr_lines / .country / .phone / .email):
     • SHIPPER / ORIGIN  address + country + phone/email → parties.origin    (Import/F2F CI only)
     • CONSIGNEE         address + country + phone/email → parties.consignee (CI, Placards, …)
     • END USER          address + country + phone/email → parties.end_user  (CI, …)
     • PICKUP LOCATION   address + country + phone/email → parties.pickup    (CI, Placards, …)
     • DELIVER TO        address + country + phone/email → parties.deliver   (CI, Placards, …)

   ADDRESS = the printed address block, i.e. parties[key].addr_lines (one entry
   per printed line — organization name, street, then "City, ST ZIP") plus the
   separate parties[key].country field. Because every shipping document reads
   parties[key].addr_lines + .country from AppState.data (CI, Placards, SLI, RFQ,
   IPC, DD1149/TOP, …), overriding them here reaches all of those documents with
   no per-document changes — exactly like the phone/email override.

   EXPORT SHIPPER / USPPI = DTRA (NOT OVERRIDABLE)
   -----------------------------------------------
   On an EXPORT CI the shipper box is the fixed DTRA exporter-of-record block
   (ci.js → CI_USPPI_DTRA) and is intentionally NOT overridable — neither its
   address nor its phone/email. The Shipper / Origin override below only reaches
   the Import/F2F CI's ORIGIN box (export ignores parties.origin entirely). If the
   DTRA details ever change, update CI_USPPI_DTRA in constants.js — or make sure
   the UDQ carries the right values.

   DEFAULT BEHAVIOR (parity)
   -------------------------
   Strictly opt-in. If the override is OFF, nothing changes — every document uses
   exactly what came out of the UDQ. When ON, only the fields the user actually
   filled in are overridden; blank fields keep the UDQ value.

   HOW THE OVERRIDE REACHES THE DOCUMENTS
   --------------------------------------
   Same approach as manual_parents: keep the pristine parse in AppState.dataBase
   and, when enabled, point AppState.data at a clone whose meta + parties carry
   the manual values. Every tool already reads AppState.data, so CI, Placards,
   the packet, RFQ, etc. pick the changes up without being individually edited.
   The override is layered ON TOP of the parent-items override (the two touch
   disjoint fields), so the order in app.js is always mp → md.

   PERSISTENCE
   -----------
   Saved per WMTR in localStorage under "atlas.shipdetails" (the "atlas."
   namespace, and explicitly listed in backup.js, so Settings backup covers it).
   ========================================================================= */

/* ---- the parties this override can touch, and their display labels ---- */

/* key = field in AppState.manualDetails; each maps directly onto
   AppState.data.parties[partyKey]. Each per-party override can carry an address
   (addr_lines[]), a country, and a POC phone/email. (The export Shipper/USPPI
   DTRA block is fixed and deliberately excluded — see the header note.) */
const MD_POC_FIELDS = [
  { key: "origin",        label: "Shipper / Origin", partyKey: "origin",
    note: "Import / F2F CI only" },
  { key: "consignee",     label: "Consignee",       partyKey: "consignee" },
  { key: "end_user",      label: "End User",        partyKey: "end_user" },
  { key: "pickup",        label: "Pickup Location", partyKey: "pickup" },
  { key: "deliver",       label: "Deliver To Location", partyKey: "deliver" },
];

const MD_TERM_FIELDS = [
  { key: "payment_terms",         label: "Payment Terms",         metaKey: "payment_terms" },
  { key: "payment_terms_remarks", label: "Payment Terms Remarks", metaKey: "payment_terms_remarks" },
  { key: "incoterm",              label: "IncoTerms",             metaKey: "incoterm" },
];

/* Tools that get the in-document override button/indicator. Other tools still
   honor the override (they read AppState.data) — they just don't host the editor. */
const MD_HOST_TOOLS = ["ci", "placards"];
function mdHostsButton(toolId) { return MD_HOST_TOOLS.indexOf(toolId) !== -1; }

/* ---- small helpers ---- */

function mdStr(v) { return String(v == null ? "" : v).trim(); }

/** Normalize address lines from an array OR a newline-separated string into a
 *  clean array of trimmed, non-empty lines (matches the udq.js safeLines shape:
 *  one entry per printed address line). */
function mdLines(v) {
  const arr = Array.isArray(v) ? v : String(v == null ? "" : v).split(/\r?\n/);
  return arr.map((s) => mdStr(s)).filter(Boolean);
}

/** A blank override object (all fields empty, disabled). */
function mdBlank() {
  const o = { enabled: false };
  for (const f of MD_TERM_FIELDS) o[f.key] = "";
  for (const f of MD_POC_FIELDS) o[f.key] = { phone: "", email: "", addr_lines: [], country: "" };
  return o;
}

/** Normalize a possibly-partial stored object into a full override object. */
function mdNormalize(src) {
  const o = mdBlank();
  if (!src || typeof src !== "object") return o;
  o.enabled = !!src.enabled;
  for (const f of MD_TERM_FIELDS) o[f.key] = mdStr(src[f.key]);
  for (const f of MD_POC_FIELDS) {
    const p = src[f.key] || {};
    o[f.key] = {
      phone: mdStr(p.phone),
      email: mdStr(p.email),
      addr_lines: mdLines(p.addr_lines),
      country: mdStr(p.country),
    };
  }
  return o;
}

/** Does this override carry ANY filled-in value? (ignores the enabled flag) */
function mdHasAnyValue(o) {
  if (!o) return false;
  for (const f of MD_TERM_FIELDS) if (mdStr(o[f.key])) return true;
  for (const f of MD_POC_FIELDS) {
    const p = o[f.key] || {};
    if (mdStr(p.phone) || mdStr(p.email) || mdStr(p.country) || mdLines(p.addr_lines).length) return true;
  }
  return false;
}

/** The override is on AND there's something filled in to apply. */
function mdActive() {
  const o = (typeof AppState !== "undefined") ? AppState.manualDetails : null;
  return !!(o && o.enabled && mdHasAnyValue(o));
}

/** A short list of the field labels currently being overridden (for the badge). */
function mdActiveLabels() {
  const o = (typeof AppState !== "undefined") ? AppState.manualDetails : null;
  if (!o) return [];
  const out = [];
  for (const f of MD_TERM_FIELDS) if (mdStr(o[f.key])) out.push(f.label);
  for (const f of MD_POC_FIELDS) {
    const p = o[f.key] || {};
    if (mdStr(p.phone) || mdStr(p.email)) out.push(f.label + " POC");
    if (mdLines(p.addr_lines).length || mdStr(p.country)) out.push(f.label + " address");
  }
  return out;
}

/* =========================================================================
   Apply the override onto AppState.data

   mdApplyToData() returns the data model the documents should see: when the
   override is off (or empty) it returns the input untouched; otherwise a clone
   with overridden meta + parties. It always CLONES before mutating so the
   pristine AppState.dataBase is never corrupted.
   ========================================================================= */

function mdApplyToData(data) {
  if (!data) return data;
  if (typeof AppState !== "undefined" && AppState.udqType !== "srf") return data;
  if (!mdActive()) return data;

  const o = AppState.manualDetails;

  const meta = Object.assign({}, data.meta);
  for (const f of MD_TERM_FIELDS) {
    const v = mdStr(o[f.key]);
    if (v) meta[f.metaKey] = v;
  }
  const parties = Object.assign({}, data.parties);
  for (const f of MD_POC_FIELDS) {
    const ov = o[f.key] || {};
    const phone = mdStr(ov.phone), email = mdStr(ov.email);
    const lines = mdLines(ov.addr_lines), country = mdStr(ov.country);
    if ((phone || email || lines.length || country) && parties[f.partyKey]) {
      const cur = parties[f.partyKey];
      parties[f.partyKey] = Object.assign({}, cur, {
        phone: phone || cur.phone,
        email: email || cur.email,
        addr_lines: lines.length ? lines : cur.addr_lines,
        country: country || cur.country,
      });
    }
  }

  return Object.assign({}, data, { meta, parties });
}

/** Point AppState.data (already mp-applied by the caller) at the overridden view.
 *  Called in app.js right AFTER mpApplyGlobal()/mpApplyForActiveTool(). */
function mdApplyGlobal() {
  if (typeof AppState === "undefined" || !AppState.data) return;
  AppState.data = mdApplyToData(AppState.data);
}

/** Re-derive a clean base (via the parent-items override) then re-apply this one.
 *  Used by out-of-lifecycle changes (dialog Save) so cleared fields fall back to
 *  the UDQ instead of leaving a stale prior override in place. */
function mdRecomputeActive() {
  if (typeof mpApplyForActiveTool === "function") mpApplyForActiveTool();
  else if (AppState.dataBase) AppState.data = AppState.dataBase;
  mdApplyGlobal();
}

/** Rebuild the active document's preview in place (keeps the form state). */
function mdRefreshActivePreview() {
  const fns = {
    ci: (typeof updateCiPreview === "function") ? updateCiPreview : null,
    placards: (typeof updatePlacardsPreview === "function") ? updatePlacardsPreview : null,
  };
  const fn = fns[(typeof AppState !== "undefined") ? AppState.activeTool : null];
  if (fn) { try { fn(); } catch (e) { /* next render catches up */ } }
}

/* =========================================================================
   Per-WMTR persistence (localStorage, "atlas." namespace)
   ========================================================================= */

const MD_STORE_KEY = "atlas.shipdetails";

function mdStoreLoad() {
  try {
    const raw = (typeof localStorage !== "undefined") ? localStorage.getItem(MD_STORE_KEY) : null;
    const o = raw ? JSON.parse(raw) : {};
    return (o && typeof o === "object") ? o : {};
  } catch (e) { return {}; }
}
function mdStoreSave(map) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(MD_STORE_KEY, JSON.stringify(map)); return true; }
  catch (e) { return false; }
}

/** Current shipment's WMTR (from the pristine parse). "" if unknown. */
function mdCurrentWmtr() {
  if (typeof AppState === "undefined") return "";
  const b = AppState.dataBase || AppState.data;
  return (b && b.meta && b.meta.wmtr) ? String(b.meta.wmtr).trim() : "";
}

/** Save (or clear) the current WMTR's override. */
function mdPersistCurrent() {
  const wmtr = mdCurrentWmtr();
  if (!wmtr) return;
  const map = mdStoreLoad();
  const o = AppState.manualDetails;
  if (o && mdHasAnyValue(o)) {
    map[wmtr] = Object.assign(mdNormalize(o), { savedAt: new Date().toISOString() });
  } else {
    delete map[wmtr];          // nothing meaningful to keep
  }
  mdStoreSave(map);
}

/** Restore a saved override for a WMTR into AppState.manualDetails.
 *  Returns true if something was restored. */
function mdRestoreForWmtr(wmtr) {
  if (!wmtr) return false;
  const e = mdStoreLoad()[wmtr];
  if (e && mdHasAnyValue(e)) {
    AppState.manualDetails = Object.assign(mdNormalize(e), { _restored: true });
    return true;
  }
  return false;
}

/** Called from loadFile right after an SRF UDQ is parsed. */
function mdOnSrfLoaded() {
  if (typeof AppState === "undefined" || AppState.udqType !== "srf") return;
  const wmtr = mdCurrentWmtr();
  if (!wmtr) return;
  if (mdRestoreForWmtr(wmtr)) {
    mdApplyGlobal();
    const status = document.getElementById("loadStatus");
    if (status) {
      status.textContent += mdActive()
        ? `  •  Restored your saved manual shipping details for this WMTR — the Commercial Invoice and Placards are using them.`
        : `  •  Restored your saved manual shipping details for this WMTR (currently turned off).`;
    }
    if (typeof atlasAnnounce === "function") {
      try { atlasAnnounce("Saved manual shipping details were restored for this WMTR."); } catch (e) {}
    }
  }
}

/* =========================================================================
   In-document indicator bar + button (injected into CI / Placards workspaces)
   No top-of-page link or dashboard banner — the editor lives with the document.
   ========================================================================= */

function mdEnsureStyle() {
  if (document.getElementById("mdDocStyle")) return;
  const s = document.createElement("style");
  s.id = "mdDocStyle";
  s.textContent = `
  .md-docbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 14px;padding:9px 12px;
    border:1px solid var(--line);border-left:4px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);transition:background .15s,border-color .15s;}
  .md-docbar.on{border-left-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);}
  .md-docbar .md-db-lbl{font:600 .8rem var(--disp);letter-spacing:.02em;color:var(--ink);text-transform:uppercase;}
  .md-docbar .md-db-badge{display:none;font:700 .68rem var(--disp);letter-spacing:.06em;background:var(--accent);color:#fff;border-radius:5px;padding:2px 7px;}
  .md-docbar.on .md-db-badge{display:inline-block;}
  .md-docbar .md-db-state{font-size:.86rem;color:var(--steel);flex:1 1 240px;}
  .md-docbar .md-db-state strong{color:var(--ink);}
  .md-docbar .md-db-edit{margin-left:auto;}

  .md-overlay{position:fixed;inset:0;background:rgba(12,18,28,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1100;padding:5vh 16px;overflow:auto;}
  .md-dialog{background:var(--card);color:inherit;border:1px solid var(--line);border-radius:12px;max-width:720px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.3);}
  .md-dialog header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);}
  .md-dialog header h2{margin:0;font:600 1.05rem var(--disp);}
  .md-dialog header .x{margin-left:auto;background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:var(--steel);}
  .md-body{padding:14px 18px;max-height:74vh;overflow:auto;}
  .md-intro{font-size:.9rem;color:var(--steel);margin:0 0 10px;line-height:1.45;}
  .md-intro strong{color:inherit;}
  .md-toggle{display:flex;align-items:flex-start;gap:9px;border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:9px;padding:10px 12px;margin-bottom:14px;background:var(--card);color:var(--ink);}
  .md-toggle input{margin-top:3px;flex:0 0 auto;width:16px;height:16px;accent-color:var(--accent);}
  .md-toggle label{font-size:.92rem;line-height:1.4;cursor:pointer;color:var(--ink);}
  .md-toggle .hint{display:block;color:var(--steel);font-size:.82rem;margin-top:2px;}
  .md-sec{margin:0 0 16px;}
  .md-sec h3{font:600 .74rem var(--disp);letter-spacing:.05em;text-transform:uppercase;color:var(--steel);margin:0 0 8px;border-bottom:1px solid var(--line);padding-bottom:5px;}
  .md-row{display:flex;align-items:center;gap:10px;margin-bottom:9px;flex-wrap:wrap;}
  .md-row .md-rl{flex:0 0 150px;font-size:.86rem;color:var(--ink);}
  .md-row .md-rl small{display:block;color:var(--steel);font-size:.72rem;font-weight:400;}
  .md-row .md-in{flex:1 1 160px;display:flex;flex-direction:column;gap:2px;min-width:140px;}
  .md-row .md-in label{font-size:.68rem;color:var(--steel);text-transform:uppercase;letter-spacing:.03em;}
  .md-row input{box-sizing:border-box;background:var(--card);color:inherit;border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:inherit;font-size:.86rem;}
  .md-row textarea{box-sizing:border-box;width:100%;background:var(--card);color:inherit;border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:inherit;font-size:.86rem;line-height:1.35;resize:vertical;min-height:64px;}
  .md-row .md-in-addr{flex:1 1 100%;}
  .md-row .md-hint-inline{text-transform:none;letter-spacing:0;font-weight:400;color:var(--steel);}
  .md-prow{align-items:flex-start;padding-bottom:11px;margin-bottom:11px;border-bottom:1px dashed var(--line);}
  .md-prow:last-child{border-bottom:0;margin-bottom:0;padding-bottom:0;}
  .md-prow .md-rl{flex:0 0 100%;font-weight:600;}
  .md-foot{display:flex;align-items:center;gap:10px;padding:14px 18px;border-top:1px solid var(--line);}
  .md-foot .spacer{margin-left:auto;}
  .btn.btn-sm{font-size:12px;letter-spacing:.6px;padding:6px 12px;}
  `;
  document.head.appendChild(s);
}

function _mdDocBarStateHtml() {
  if (!mdActive()) {
    return `Using <strong>UDQ values</strong> — no manual overrides in effect.`;
  }
  const labels = mdActiveLabels();
  return `Using <strong>manual details</strong> for: ${esc(labels.join(", "))}.`;
}

/** Inject the indicator bar + edit button at the top of the CI/Placards panel. */
function mdInjectDocBar(container, toolId) {
  if (!container) return;
  if (typeof AppState === "undefined" || AppState.udqType !== "srf" || !AppState.data) return;
  if (!mdHostsButton(toolId)) return;
  mdEnsureStyle();

  const on = mdActive();
  const bar = el(`
    <div class="md-docbar${on ? " on" : ""}" id="mdDocBar">
      <span class="md-db-lbl">Manual details</span>
      <span class="md-db-badge">MANUAL</span>
      <span class="md-db-state" id="mdDocState">${_mdDocBarStateHtml()}</span>
      <button class="btn ghost btn-sm md-db-edit" type="button" id="mdDocEdit">${on ? "Edit manual details" : "Override details"}</button>
    </div>`);

  const body = container.querySelector(".panel > .body") || container.querySelector(".panel") || container;
  body.insertBefore(bar, body.firstChild);
  bar.querySelector("#mdDocEdit").addEventListener("click", openManualDetails);
}

/** Refresh the in-place bar after a save (no full re-render). */
function mdRefreshDocBar() {
  const bar = document.getElementById("mdDocBar");
  if (!bar) return;
  const on = mdActive();
  bar.classList.toggle("on", on);
  const st = bar.querySelector("#mdDocState");
  if (st) st.innerHTML = _mdDocBarStateHtml();
  const edit = bar.querySelector("#mdDocEdit");
  if (edit) edit.textContent = on ? "Edit manual details" : "Override details";
}

/* =========================================================================
   Dialog
   ========================================================================= */

function closeManualDetails() {
  const o = document.getElementById("mdOverlay");
  if (o) o.remove();
  document.removeEventListener("keydown", _mdEsc);
}
function _mdEsc(e) { if (e.key === "Escape") closeManualDetails(); }

/** UDQ (pristine) value for a meta field, shown as the input placeholder. */
function _mdUdqMeta(metaKey) {
  const b = (typeof AppState !== "undefined") ? (AppState.dataBase || AppState.data) : null;
  return (b && b.meta) ? mdStr(b.meta[metaKey]) : "";
}
/** UDQ (pristine) phone/email/address/country for a party, shown as placeholders. */
function _mdUdqParty(partyKey) {
  const b = (typeof AppState !== "undefined") ? (AppState.dataBase || AppState.data) : null;
  const p = (b && b.parties && partyKey) ? b.parties[partyKey] : null;
  return {
    phone: p ? mdStr(p.phone) : "",
    email: p ? mdStr(p.email) : "",
    addr_lines: p ? mdLines(p.addr_lines) : [],
    country: p ? mdStr(p.country) : "",
  };
}

function _mdTermRowHtml(f, cur) {
  const ph = _mdUdqMeta(f.metaKey);
  return `
    <div class="md-row">
      <span class="md-rl">${esc(f.label)}</span>
      <span class="md-in" style="flex:1 1 100%;">
        <label for="md_${f.key}">Override</label>
        <input type="text" id="md_${f.key}" data-term="${f.key}" value="${esc(cur)}"
               placeholder="${ph ? "UDQ: " + esc(ph) : "(leave blank to keep UDQ)"}">
      </span>
    </div>`;
}

function _mdPocRowHtml(f, cur) {
  const ph = f.partyKey ? _mdUdqParty(f.partyKey) : { phone: "", email: "", addr_lines: [], country: "" };
  const sub = f.note ? `<small>${esc(f.note)}</small>` : "";
  const addrVal = (cur.addr_lines || []).join("\n");
  const addrPh = ph.addr_lines.length
    ? "UDQ:\n" + ph.addr_lines.join("\n")
    : "(leave blank to keep the UDQ address)";
  return `
    <div class="md-row md-prow">
      <span class="md-rl">${esc(f.label)}${sub}</span>
      <span class="md-in md-in-addr">
        <label for="md_${f.key}_addr">Address
          <span class="md-hint-inline">— one line per printed row (org name, street, then “City, ST ZIP”)</span></label>
        <textarea id="md_${f.key}_addr" data-addr="${f.key}" rows="3"
                  placeholder="${esc(addrPh)}">${esc(addrVal)}</textarea>
      </span>
      <span class="md-in">
        <label for="md_${f.key}_country">Country</label>
        <input type="text" id="md_${f.key}_country" data-country="${f.key}" value="${esc(cur.country)}"
               placeholder="${ph.country ? "UDQ: " + esc(ph.country) : "(keep UDQ)"}">
      </span>
      <span class="md-in">
        <label for="md_${f.key}_phone">Phone</label>
        <input type="text" id="md_${f.key}_phone" data-poc="${f.key}" data-sub="phone" value="${esc(cur.phone)}"
               placeholder="${ph.phone ? "UDQ: " + esc(ph.phone) : "(keep UDQ)"}">
      </span>
      <span class="md-in">
        <label for="md_${f.key}_email">E-mail</label>
        <input type="text" id="md_${f.key}_email" data-poc="${f.key}" data-sub="email" value="${esc(cur.email)}"
               placeholder="${ph.email ? "UDQ: " + esc(ph.email) : "(keep UDQ)"}">
      </span>
    </div>`;
}

function openManualDetails() {
  if (typeof AppState === "undefined" || AppState.udqType !== "srf" || !AppState.data) {
    alert("Load an SRF UDQ first — manual shipping details apply to SRF shipping documents.");
    return;
  }
  closeManualDetails();
  mdEnsureStyle();

  const cur = mdNormalize(AppState.manualDetails);
  const wmtr = mdCurrentWmtr();

  const termRows = MD_TERM_FIELDS.map((f) => _mdTermRowHtml(f, cur[f.key])).join("");
  const pocRows = MD_POC_FIELDS.map((f) => _mdPocRowHtml(f, cur[f.key])).join("");

  const overlay = el(`
    <div class="md-overlay" id="mdOverlay">
      <div class="md-dialog" role="dialog" aria-modal="true" aria-label="Manual shipping details">
        <header><h2>Manual shipping details</h2><button class="x" id="mdX" title="Close" aria-label="Close">×</button></header>
        <div class="md-body">
          <p class="md-intro">Overwrite details that were corrected <strong>after Compliance Review</strong> and can no longer be
            edited in ATLAS. When the override is on, the Commercial Invoice, Placards and other shipping documents use the values
            you enter here instead of the UDQ. <strong>Leave a field blank to keep the UDQ value.</strong>
            Entries are saved for this WMTR${wmtr ? ` (${esc(wmtr)})` : ""}, so they return automatically if you reopen this UDQ.</p>

          <div class="md-toggle">
            <input type="checkbox" id="mdEnabled" ${cur.enabled ? "checked" : ""}>
            <label for="mdEnabled">Use these manual details for the shipping documents (override the UDQ)
              <span class="hint">Off = use the UDQ values as normal. You can keep entries saved here and toggle this any time.</span>
            </label>
          </div>

          <div class="md-sec">
            <h3>Invoice terms <span style="font-weight:400;text-transform:none;letter-spacing:0;">(Commercial Invoice)</span></h3>
            ${termRows}
          </div>

          <div class="md-sec">
            <h3>Party addresses &amp; contacts <span style="font-weight:400;text-transform:none;letter-spacing:0;">(address, country, phone &amp; e-mail)</span></h3>
            ${pocRows}
          </div>
        </div>
        <div class="md-foot">
          <span class="md-note" style="color:var(--steel);font-size:.82rem;">Address, country and phone/e-mail overrides feed every document that prints that party (CI, SLI, RFQ, IPC, DD&nbsp;1149/TOP …); placards use Pickup, Deliver To and Consignee.</span>
          <span class="spacer"></span>
          <button class="btn ghost" id="mdCancel" type="button">Cancel</button>
          <button class="btn primary" id="mdSave" type="button">Save</button>
        </div>
      </div>
    </div>`);

  document.body.appendChild(overlay);

  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeManualDetails(); });
  overlay.querySelector("#mdX").addEventListener("click", closeManualDetails);
  overlay.querySelector("#mdCancel").addEventListener("click", closeManualDetails);
  document.addEventListener("keydown", _mdEsc);

  // Editing any value implies intent to use it — auto-check the enable box.
  const autoEnable = () => {
    const cb = document.getElementById("mdEnabled");
    if (cb && !cb.checked) cb.checked = true;
  };
  overlay.querySelector(".md-body").addEventListener("input", (e) => {
    if (e.target && e.target.id !== "mdEnabled") autoEnable();
  });

  overlay.querySelector("#mdSave").addEventListener("click", () => {
    const o = mdBlank();
    o.enabled = !!overlay.querySelector("#mdEnabled").checked;
    overlay.querySelectorAll("input[data-term]").forEach((inp) => { o[inp.dataset.term] = mdStr(inp.value); });
    overlay.querySelectorAll("input[data-poc]").forEach((inp) => {
      o[inp.dataset.poc][inp.dataset.sub] = mdStr(inp.value);
    });
    overlay.querySelectorAll("textarea[data-addr]").forEach((t) => {
      o[t.dataset.addr].addr_lines = mdLines(t.value);
    });
    overlay.querySelectorAll("input[data-country]").forEach((inp) => {
      o[inp.dataset.country].country = mdStr(inp.value);
    });

    if (o.enabled && !mdHasAnyValue(o)) {
      alert("Enter at least one override value before turning the override on (or leave it off to keep using the UDQ).");
      return;
    }

    AppState.manualDetails = o;
    mdPersistCurrent();                 // remember for this WMTR
    closeManualDetails();
    mdRecomputeActive();                // rebuild AppState.data from base + overrides
    mdRefreshActivePreview();           // update the open document's preview
    mdRefreshDocBar();                  // update the in-document indicator

    const status = document.getElementById("loadStatus");
    if (status) {
      status.textContent = mdActive()
        ? `Manual shipping details ON — overriding: ${mdActiveLabels().join(", ")}.`
        : `Manual shipping details saved but OFF — documents use the UDQ values.`;
      status.classList.remove("err");
    }
    if (typeof atlasAnnounce === "function") {
      try { atlasAnnounce(mdActive() ? "Manual shipping details enabled." : "Manual shipping details saved, override off."); } catch (e) {}
    }
  });
}

/* ---------- Node test support ---------- */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    mdBlank, mdNormalize, mdHasAnyValue, mdApplyToData, mdLines,
    MD_POC_FIELDS, MD_TERM_FIELDS,
  };
}
