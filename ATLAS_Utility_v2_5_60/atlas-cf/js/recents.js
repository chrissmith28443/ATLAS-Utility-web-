/* =========================================================================
   ATLAS Utility Web — recents.js
   "Recent UDQs" — remembers the last several UDQs you opened, by metadata only
   (WMTR, title, type, filename, timestamp). The file itself is NEVER stored, so
   this is orientation only ("what was I working on") — you re-drop the file to
   work on it. Same localStorage pattern as the audit log; per-browser.
   ========================================================================= */
const RecentUdqs = {
  KEY: "atlas.recents",
  MAX: 10,
  _data: null,
  _open: false,   // collapsed by default — revealed via the "Recent UDQs" link in the actions row
  load() {
    if (this._data) return this._data;
    let a = [];
    try { a = JSON.parse(localStorage.getItem(this.KEY) || "[]"); } catch (e) { a = []; }
    this._data = Array.isArray(a) ? a : [];
    return this._data;
  },
  all() { return this.load(); },
  _key(e) { return (e.wmtr || e.fileName || "") + "|" + (e.udqType || ""); },
  record(entry) {
    const k = this._key(entry);
    if (!k.replace("|", "")) return; // nothing identifying — skip
    const a = this.load().filter((e) => this._key(e) !== k);
    a.unshift(Object.assign({ ts: new Date().toISOString() }, entry));
    if (a.length > this.MAX) a.length = this.MAX;
    this._data = a;
    try { localStorage.setItem(this.KEY, JSON.stringify(a)); } catch (e) { /* storage off */ }
  },
  clear() {
    this._data = [];
    try { localStorage.removeItem(this.KEY); } catch (e) { /* ignore */ }
  },
};

function recentsRecordFromState() {
  if (typeof AppState === "undefined" || !AppState.udqType) return;
  const t = AppState.udqType;
  if (t !== "srf" && t !== "property" && t !== "metrics") return;
  let wmtr = "", title = "";
  if (AppState.data && AppState.data.meta) {
    wmtr = AppState.data.meta.wmtr || AppState.data.meta.wmtr_last5 || "";
    title = AppState.data.meta.request_title || "";
  }
  RecentUdqs.record({ wmtr: String(wmtr), title: String(title), udqType: t, fileName: AppState.fileName || "" });
}

function _recentsTypeLabel(t) {
  return t === "srf" ? "SRF" : t === "property" ? "Property" : t === "metrics" ? "Metrics" : (t || "UDQ");
}

function _recentsAgo(ts) {
  const then = new Date(ts).getTime();
  if (!then) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60); if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24); if (d < 7) return d + "d ago";
  try { return new Date(ts).toLocaleDateString(); } catch (e) { return ""; }
}

/** Whether there are any recent UDQs to show (drives the actions-row link). */
function recentsHasAny() {
  try { return RecentUdqs.all().length > 0; } catch (e) { return false; }
}

/** Show/hide the recents list (the orange "Recent UDQs" link toggles this). */
function recentsToggle() {
  RecentUdqs._open = !RecentUdqs._open;
  recentsRender();
  if (typeof renderUdqActions === "function") renderUdqActions();
}

function recentsRender() {
  const host = document.getElementById("recentUdqs");
  if (!host) return;
  const rows = RecentUdqs.all();
  if (!rows.length) { host.innerHTML = ""; RecentUdqs._open = false; return; }
  // The "Recent UDQs" section is collapsed by default to stay out of the way;
  // it's revealed only when the user clicks the orange link in the actions row.
  host.innerHTML = `
    <div class="recents${RecentUdqs._open ? "" : " hidden"}">
      <div class="recents-head">
        <span>Recent UDQs</span>
        <button class="recents-clear" id="recentsClear" type="button">Clear</button>
      </div>
      <ul class="recents-list">
        ${rows.map((e) => `
          <li>
            <span class="recents-type">${esc(_recentsTypeLabel(e.udqType))}</span>
            <span class="recents-wmtr">${esc(e.wmtr || "—")}</span>
            <span class="recents-title">${esc(e.title || e.fileName || "")}</span>
            <span class="recents-ago">${esc(_recentsAgo(e.ts))}</span>
          </li>`).join("")}
      </ul>
      <div class="recents-note">For orientation only — the file isn't stored, so drop it again to work on it.</div>
    </div>`;
  const c = document.getElementById("recentsClear");
  if (c) c.addEventListener("click", () => { RecentUdqs.clear(); RecentUdqs._open = false; recentsRender(); if (typeof renderUdqActions === "function") renderUdqActions(); });
}
