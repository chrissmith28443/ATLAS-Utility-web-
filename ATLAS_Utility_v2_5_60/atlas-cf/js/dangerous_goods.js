/* =========================================================================
   ATLAS Utility Web — dangerous_goods.js
   Dangerous-goods flag (Feature #8).

   Uses the per-item hazmat fields the web reader now captures (UN Code +
   HAZMAT/Dangerous Goods Classification) to flag which line items are dangerous
   goods and therefore require a separate Dangerous Goods Declaration (DGD).

   An item is treated as dangerous goods if it carries a UN code OR a hazard
   class. Each is marked:
     - "Classified"          — UN code AND hazard class present (ready for a DGD)
     - "Missing hazard class"— UN code present, class blank (incomplete)
     - "Missing UN code"     — class present, UN blank (incomplete)

   Surfaced as a prominent panel on the SRF shipment dashboard. This complements
   the pre-flight validator (which raises the incomplete-classification cases as
   errors/warnings); here the focus is the actionable DGD requirement.
   ========================================================================= */

function dgIsDangerous(it) {
  return !!(normWs(it.un_code) || normWs(it.hazmat_class));
}

/** Assess the shipment's inventory for dangerous goods. */
function dgAssess(data) {
  const items = (data && data.items) || [];
  const dg = [];
  for (const it of items) {
    if (!dgIsDangerous(it)) continue;
    const un = norm(it.un_code);
    const cls = norm(it.hazmat_class);
    let status, kind;
    if (un && cls) { status = "Classified"; kind = "ok"; }
    else if (un && !cls) { status = "Missing hazard class"; kind = "bad"; }
    else { status = "Missing UN code"; kind = "warn"; }
    dg.push({ line: it.line, desc: it.desc, un_code: un, hazmat_class: cls, status, kind });
  }
  return {
    items: dg,
    count: dg.length,
    anyIncomplete: dg.some((d) => d.kind !== "ok"),
    needsDgd: dg.length > 0,
  };
}

/** Build the dashboard dangerous-goods panel, or null when there are none. */
function dgDashboardSection() {
  if (!AppState.data || AppState.udqType !== "srf") return null;
  const a = dgAssess(AppState.data);
  if (!a.count) return null;

  const rows = a.items.map((d) => `
    <tr>
      <td class="num">${esc(String(d.line))}</td>
      <td>${esc(d.desc) || "—"}</td>
      <td class="mono">${esc(d.un_code) || "—"}</td>
      <td>${esc(d.hazmat_class) || "—"}</td>
      <td class="${d.kind === "bad" ? "dg-bad" : d.kind === "warn" ? "dg-warn" : "dg-ok"}">${esc(d.status)}</td>
    </tr>`).join("");

  const lead = a.count === 1
    ? `1 line item is a dangerous good and requires a separate <strong>Dangerous Goods Declaration (DGD)</strong>.`
    : `${a.count} line items are dangerous goods and require a separate <strong>Dangerous Goods Declaration (DGD)</strong>.`;

  const incomplete = a.anyIncomplete
    ? `<div class="dg-note">⚠ Some items have incomplete classification — complete the UN code and hazard class before filing the DGD.</div>`
    : "";

  return el(`
    <div class="panel dg-panel">
      <header><h2><span class="dg-flag">⚠ Dangerous goods</span></h2>
        <span class="count">${a.count} item${a.count === 1 ? "" : "s"} · DGD required</span></header>
      <div class="body">
        <div class="dg-lead">${lead}</div>
        <div class="scrollwrap">
          <table class="data">
            <thead><tr><th>#</th><th>Description</th><th>UN code</th><th>Hazard class</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${incomplete}
      </div>
    </div>`);
}

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { dgIsDangerous, dgAssess };
}
