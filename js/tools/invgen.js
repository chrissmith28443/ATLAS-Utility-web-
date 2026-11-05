/* =========================================================================
   ATLAS Utility Web — invgen.js
   Property management › Inventory List Export, and the SLI's second tab
   (invgenAddSrfSheet — a Shipping request's inventory on the SRF template).
   Builds an ATLAS Inventory List template (SRF, PR, WS or PMCT) from the
   loaded/fetched WMTR's own Inventory List section, ready to upload into
   another request. Most common case: a procured PR → an SRF to ship it, so a
   Property (PR) WMTR defaults to SRF and a Shipping (SRF) WMTR defaults to PR.

   Reads the raw UDQ grid (Excel load and ATLAS fetch both produce one), maps
   each UDQ inventory header to a template field, then hands the rows to the
   Inventory Crosswalk writer (invconv.js) — same templates, same carryover tab
   for anything with no home in the chosen format.
   ========================================================================= */

/* UDQ inventory header (normalized) -> template field key. Covers both the
   Shipping (SRF) and the Property (PR / ProcurementInventory) export columns. */
const INVGEN_UDQ_KEYS = {
  "serial #": "serial", "purchase order": "po", "description": "desc",
  "model/catalog number": "model", "model / catalog no": "model",
  "vendor": "vendor", "manufacturer": "mfr",
  "recommended vendor": "vendorRec", "actual vendor": "vendorAct",
  "recommended manufacturer": "mfrRec", "actual manufacturer": "mfrAct",
  "brand name only?": "brandOnly", "original equipment manufacturer": "oem",
  "quantity": "qty", "quantity requested": "qtyReq", "quantity ordered": "qtyOrd",
  "qty received": "qtyRcv", "quantity received": "qtyRcv",
  "unit of measure": "um", "unit of measure requested": "umReq", "unit of measure ordered": "umOrd",
  "unit of issue": "ui", "value(usd)": "value", "value (usd)": "value",
  "estimated weight(lbs)": "estWtLb", "estimated weight(kg)": "estWtKg",
  "final weight(lbs)": "finWtLb", "final weight(kg)": "finWtKg",
  "eccn/usml": "eccn", "schedule b/hts code": "hts",
  "material/equipment manufacture country of origin": "coo",
  "equipment manufacture country of origin": "coo",
  "specific temperature control requirements": "temp", "temperature control requirements": "temp",
  "shelf life/expiration date for perishable items": "shelf",
  "hazmat/dangerous goods classification": "haz", "hazmat classification": "haz",
  "material handling requirements": "handling", "installation requirements": "install",
  "interim,en-route,or term storage requirements": "termStorage", "property type": "propType",
  "estimated shipping cost to trls warehouse": "shipCost",
  "actual trls warehouse delivery date": "trlsDate",
  "current custody": "custody", "country": "country", "city": "city",
  "general comments": "comments", "ship group #": "group", "pr group #": "group",
  "bis/ddtc authorization or exception": "auth", "un code": "unCode",
};

/* Combined "L x W x H" columns -> the template's separate inch columns. */
const INVGEN_DIM_COLS = {
  "estimated dimentions (l x w x h)": ["estLnIn", "estWdIn", "estHtIn"],
  "final dimentions (l x w x h)": ["finLnIn", "finWdIn", "finHtIn"],
};

const INVGEN_NUM_KEYS = new Set(["qty", "qtyReq", "qtyOrd", "qtyRcv", "value", "shipCost", "leadTime",
  "estWtLb", "estWtKg", "finWtLb", "finWtKg"]);

const InvGenUi = { target: null, wmtr: null, includePkgs: false };

function invgenUdqKey(label) {
  const n = invconvNormHdr(label);
  if (!n) return null;
  if (INVGEN_UDQ_KEYS[n]) return INVGEN_UDQ_KEYS[n];
  if (n.startsWith("leadtime")) return "leadTime";
  return "x:" + n;
}

/** UDQ cell text -> the type the template column expects. */
function invgenValue(key, s) {
  s = String(s).trim();
  if (INVGEN_NUM_KEYS.has(key)) {
    const t = s.replace(/[$,\s]/g, "");
    if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
    return s;
  }
  if (key === "shelf" || key === "trlsDate") {
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s|$)/);
    let y, mo, d;
    if (m) { mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
    else if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    if (y) return Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
    return s;
  }
  if (key === "brandOnly") {
    if (/^(true|yes|y)$/i.test(s)) return true;
    if (/^(false|no|n)$/i.test(s)) return false;
  }
  return s;
}

/** The loaded WMTR's Inventory List -> { recs, labels, pkgCount }. */
function invgenReadInventory(grid, includePkgs) {
  const hdrRow = inventoryHeaderRow(grid);
  const start = hdrRow + 1;
  const end = inventoryEndRow(grid);
  const cols = [];
  const seen = {};
  for (let c = 1; c <= gridMaxCol(grid); c++) {
    const label = normWs(gridCell(grid, hdrRow, c));
    const n = invconvNormHdr(label);
    if (!n || seen[n]) continue;
    seen[n] = 1;
    cols.push({ c, label, n, key: INVGEN_DIM_COLS[n] ? null : invgenUdqKey(label) });
  }
  const labels = {};
  for (const col of cols) if (col.key) labels[col.key] = col.label;

  const recs = [];
  let pkgCount = 0;
  for (let r = start; r <= end; r++) {
    const rec = {};
    let content = false;
    for (const col of cols) {
      const raw = normWs(gridCell(grid, r, col.c));
      if (!raw) continue;
      const dimKeys = INVGEN_DIM_COLS[col.n];
      if (dimKeys) {
        // ATLAS writes "50.00 x 40.00 x 45.00 (in)", or " x  x  (in)" when empty.
        if (!/\d/.test(raw)) continue;
        const [L, W, H] = parseDimsIn(raw);
        const keys = /\(cm\)/i.test(raw) ? dimKeys.map((k) => k.replace(/In$/, "Cm")) : dimKeys;
        if (L && W && H) { rec[keys[0]] = L; rec[keys[1]] = W; rec[keys[2]] = H; }
        else { rec["x:" + col.n] = raw; labels["x:" + col.n] = col.label; }
      } else {
        rec[col.key] = invgenValue(col.key, raw);
      }
      content = true;
    }
    if (!content) continue;
    if (invconvNormHdr(rec.desc) === "description") continue;   // repeated header row
    if (String(rec.serial || "").toUpperCase() === "P") {
      pkgCount++;
      if (!includePkgs) continue;
    }
    rec.item = recs.length + 1;
    recs.push(rec);
  }
  return { recs, labels, pkgCount };
}

function renderInvGenWorkspace(container) {
  const isPr = AppState.udqType === "property";
  const meta = (AppState.data && AppState.data.meta) || {};
  // Default per WMTR: PR → SRF (ship what was procured), SRF → PR. Kept while
  // the same WMTR stays loaded, reset when another one is.
  if (InvGenUi.wmtr !== meta.wmtr) {
    InvGenUi.wmtr = meta.wmtr;
    InvGenUi.target = isPr ? "SRF" : "PR";
    InvGenUi.includePkgs = false;
  }
  const inv = invgenReadInventory(AppState.grid, InvGenUi.includePkgs);

  const radios = INVCONV_FORMATS.map((f) => `
    <label class="ic-fmt"><input type="radio" name="igFmt" value="${f.id}"${InvGenUi.target === f.id ? " checked" : ""}> ${esc(f.label)}</label>`).join("");
  const rows = inv.recs.map((r) => `
    <tr><td class="num">${esc(r.item)}</td><td>${esc(r.desc || "")}</td><td>${esc(r.model || "")}</td>
      <td class="num">${esc(r.qtyReq ?? r.qty ?? "")}</td><td>${esc(r.umReq || r.um || "")}</td>
      <td class="num">${esc(r.value ?? "")}</td></tr>`).join("");

  const panel = el(`
    <div class="panel">
      <header><h2>Inventory List Export</h2><span class="count">${esc(meta.wmtr || "")}</span></header>
      <div class="body">
        <div class="note">
          Builds an ATLAS Inventory List template from this ${isPr ? "Property (PR)" : "Shipping (SRF)"} request's
          inventory, ready to upload into another request. Defaults to <strong>${isPr ? "SRF" : "PR"}</strong>;
          pick a different format if you need one.
        </div>

        <div class="ic-out">
          <div class="ic-outhead">Template format</div>
          <div class="ic-fmts">${radios}</div>
          ${inv.pkgCount ? `
          <label class="ic-fmt ig-pkgs"><input type="checkbox" id="igPkgs"${InvGenUi.includePkgs ? " checked" : ""}>
            Include package rows (Serial # = P) — ${inv.pkgCount} in this request</label>` : ""}
        </div>

        <div class="btnrow"><button class="btn primary" id="igGo" type="button"${inv.recs.length ? "" : " disabled"}>Generate inventory list</button></div>
        <div class="statusline" id="igStatus">${inv.recs.length ? "" : "This request's Inventory List has no items."}</div>

        ${inv.recs.length ? `
        <div class="scrollwrap"><table class="data ic-table">
          <thead><tr><th>#</th><th>Description</th><th>Model/Catalog #</th><th>Qty</th><th>U/M</th><th>Value (USD)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>` : ""}
      </div>
    </div>`);
  container.appendChild(panel);

  panel.querySelectorAll('input[name="igFmt"]').forEach((rb) => rb.addEventListener("change", () => {
    if (rb.checked) InvGenUi.target = rb.value;
  }));
  const pk = panel.querySelector("#igPkgs");
  if (pk) pk.addEventListener("change", () => { InvGenUi.includePkgs = pk.checked; renderWorkspace(); });
  panel.querySelector("#igGo").addEventListener("click", invgenRun);
}

async function invgenRun() {
  const status = document.getElementById("igStatus");
  const say = (msg, err) => { if (status) { status.textContent = msg; status.classList.toggle("err", !!err); } };
  try {
    if (typeof JSZip === "undefined") throw new Error("JSZip is not available");
    const fmt = INVCONV_FORMATS.find((f) => f.id === InvGenUi.target);
    const inv = invgenReadInventory(AppState.grid, InvGenUi.includePkgs);
    const isPr = AppState.udqType === "property";
    const src = { recs: inv.recs, labels: inv.labels, sourceLabel: isPr ? "Property (PR) request" : "Shipping (SRF) request" };
    say("Building…", false);
    const r = await invconvBuild(src, fmt);
    const meta = (AppState.data && AppState.data.meta) || {};
    const last5 = meta.wmtr_last5 || "";
    const fname = `Inventory_${fmt.id}_${last5 ? last5 + "_" : ""}${fileStamp()}.xlsx`;
    _invconvDownload(fname, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", r.b64);
    say(`✅ Downloaded ${fname} — ${r.rows} item${r.rows === 1 ? "" : "s"}` +
      (r.carryLabels.length ? `. No ${fmt.label} column for: ${r.carryLabels.join(", ")} (kept on the Crosswalk Carryover tab).` : "."), false);
  } catch (e) {
    console.error(e);
    say(`Error: ${e.message}`, true);
  }
}

/* -------------------------------------------------------------------------
   SLI tab 2 (Shipping): this request's inventory on the ATLAS SRF Inventory
   List template, added to the SLI workbook (JSZip) after its own sheet. Same
   rows as Inventory List Export with SRF picked (package rows left out). The
   template's styles are appended to the workbook's and its shared strings
   made inline, so the tab looks like the template. Returns the item count —
   0 (nothing added) without a UDQ spreadsheet or with no items.
   ------------------------------------------------------------------------- */
async function invgenAddSrfSheet(zip, sheetName) {
  if (!AppState.grid || AppState.manualOnly) return 0;
  const inv = invgenReadInventory(AppState.grid, false);
  if (!inv.recs.length) return 0;
  const fmt = INVCONV_FORMATS.find((f) => f.id === "SRF");
  const built = await invconvBuild({ recs: inv.recs, labels: inv.labels, sourceLabel: "Shipping (SRF) request" }, fmt);
  const src = await JSZip.loadAsync(built.b64, { base64: true });

  const shared = _coreimsParseSharedStrings(await src.file("xl/sharedStrings.xml").async("string"));
  const merged = _invgenMergeStyles(await zip.file("xl/styles.xml").async("string"),
    await src.file("xl/styles.xml").async("string"));
  const bump = (n) => String(parseInt(n, 10) + merged.xfOffset);
  const sheet = (await src.file("xl/worksheets/sheet1.xml").async("string"))
    .replace(/<c\b([^>]*?) t="s"([^>]*)>\s*<v>(\d+)<\/v>\s*<\/c>/g, (m, a, b, i) =>
      `<c${a}${b} t="inlineStr"><is><t xml:space="preserve">${_invconvXmlEsc(shared[+i] || "")}</t></is></c>`)
    .replace(/<(c|row)\b[^>]*>/g, (tag) => tag.replace(/ s="(\d+)"/, (m, n) => ` s="${bump(n)}"`))
    .replace(/<col\b[^>]*>/g, (tag) => tag.replace(/ style="(\d+)"/, (m, n) => ` style="${bump(n)}"`))
    .replace(/ tabSelected="1"/, "");

  // A free sheet part, relationship id and sheet id.
  let n = 2;
  while (zip.file(`xl/worksheets/sheet${n}.xml`)) n++;
  const part = `worksheets/sheet${n}.xml`;
  const relsPath = "xl/_rels/workbook.xml.rels";
  let rels = await zip.file(relsPath).async("string");
  let rid = 1;
  while (rels.indexOf(`Id="rId${rid}"`) !== -1) rid++;
  rels = rels.replace("</Relationships>", () =>
    `<Relationship Id="rId${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${part}"/></Relationships>`);
  let wb = await zip.file("xl/workbook.xml").async("string");
  const sheetId = Math.max(0, ...Array.from(wb.matchAll(/<sheet\b[^>]*sheetId="(\d+)"/g), (m) => +m[1])) + 1;
  wb = wb.replace("</sheets>", () => `<sheet name="${_invconvXmlEsc(sheetName)}" sheetId="${sheetId}" r:id="rId${rid}"/></sheets>`);
  let ct = await zip.file("[Content_Types].xml").async("string");
  ct = ct.replace("</Types>", () =>
    `<Override PartName="/xl/${part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);

  zip.file(`xl/${part}`, sheet);
  zip.file("xl/styles.xml", merged.xml);
  zip.file(relsPath, rels);
  zip.file("xl/workbook.xml", wb);
  zip.file("[Content_Types].xml", ct);

  // docProps/app.xml lists the sheet names; add this one after the others.
  const app = zip.file("docProps/app.xml");
  if (app) {
    let x = await app.async("string");
    const wsM = x.match(/(<vt:lpstr>Worksheets<\/vt:lpstr><\/vt:variant><vt:variant><vt:i4>)(\d+)(<\/vt:i4>)/);
    const topM = x.match(/<TitlesOfParts><vt:vector size="(\d+)" baseType="lpstr">([\s\S]*?)<\/vt:vector><\/TitlesOfParts>/);
    if (wsM && topM) {
      const names = topM[2].match(/<vt:lpstr>[\s\S]*?<\/vt:lpstr>/g) || [];
      names.splice(+wsM[2], 0, `<vt:lpstr>${_invconvXmlEsc(sheetName)}</vt:lpstr>`);
      x = x.replace(wsM[0], () => wsM[1] + (+wsM[2] + 1) + wsM[3])
        .replace(topM[0], () => `<TitlesOfParts><vt:vector size="${names.length}" baseType="lpstr">${names.join("")}</vt:vector></TitlesOfParts>`);
      zip.file("docProps/app.xml", x);
    }
  }
  return inv.recs.length;
}

/* Append another workbook's fonts / fills / borders / number formats / cell
   formats to styles.xml `dst`. Returns the merged XML and the index the
   appended cell formats start at (add it to the source sheet's s="…"). */
function _invgenMergeStyles(dst, src) {
  const items = (xml, list, item) => {
    const m = xml.match(new RegExp(`<${list}\\b[^>]*>([\\s\\S]*?)<\\/${list}>`));
    return m ? (m[1].match(new RegExp(`<${item}\\b[^>]*\\/>|<${item}\\b[^>]*>[\\s\\S]*?<\\/${item}>`, "g")) || []) : [];
  };
  // Function replacers throughout: number formats contain "$", which a replacement string would expand.
  const put = (xml, list, all) => xml.replace(new RegExp(`<${list}\\b[^>]*>[\\s\\S]*?<\\/${list}>|<${list}\\b[^>]*\\/>`),
    () => `<${list} count="${all.length}">${all.join("")}</${list}>`);

  // Custom number formats (id 164+) get new ids after the destination's.
  const dstFmts = items(dst, "numFmts", "numFmt");
  let nextId = Math.max(163, ...dstFmts.map((f) => +(f.match(/numFmtId="(\d+)"/) || [0, 0])[1])) + 1;
  const fmtMap = {};
  const addFmts = items(src, "numFmts", "numFmt").map((f) => {
    const id = +(f.match(/numFmtId="(\d+)"/) || [0, 0])[1];
    fmtMap[id] = nextId;
    return f.replace(/numFmtId="\d+"/, `numFmtId="${nextId++}"`);
  });

  const off = {};
  let out = dst;
  for (const [list, item, key] of [["fonts", "font", "fontId"], ["fills", "fill", "fillId"], ["borders", "border", "borderId"]]) {
    const have = items(out, list, item);
    off[key] = have.length;
    out = put(out, list, have.concat(items(src, list, item)));
  }
  if (addFmts.length) {
    if (/<numFmts\b/.test(out)) out = put(out, "numFmts", dstFmts.concat(addFmts));
    else out = out.replace(/<fonts\b/, () => `<numFmts count="${addFmts.length}">${addFmts.join("")}</numFmts><fonts`);
  }
  const xfs = items(out, "cellXfs", "xf");
  const addXfs = items(src, "cellXfs", "xf").map((xf) => xf
    .replace(/fontId="(\d+)"/, (m, n) => `fontId="${+n + off.fontId}"`)
    .replace(/fillId="(\d+)"/, (m, n) => `fillId="${+n + off.fillId}"`)
    .replace(/borderId="(\d+)"/, (m, n) => `borderId="${+n + off.borderId}"`)
    .replace(/numFmtId="(\d+)"/, (m, n) => `numFmtId="${fmtMap[+n] !== undefined ? fmtMap[+n] : n}"`)
    .replace(/xfId="\d+"/, 'xfId="0"'));
  out = put(out, "cellXfs", xfs.concat(addXfs));
  return { xml: out, xfOffset: xfs.length };
}
