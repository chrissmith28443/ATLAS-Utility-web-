/* =========================================================================
   ATLAS Utility Web — tools/topdocs.js
   TOP Documents (Transfer of Property) generator — Property Management.

   FAITHFUL PORT of the desktop v4.4 "TOP Documents" tool:
     - services/top_documents_service.py  (build_top_dialog_defaults,
        _read_udq_inventory_rows, build_top_inventory_report,
        build_top_cover_doc, run_top_inventory_pipeline, run_top_cover_pipeline)
     - ui/top_documents_dialog.py         (field order, country list, CTR
        program → project-name sync, 5-digit TOP number validation, the two
        "Generate TOP" / "Generate Inventory Sheet" actions)
     - templates/TOP_Inventory_Template.xlsx (embedded in topdocs_template.js)

   Two outputs, both built entirely in the browser (no upload, no server):
     1. TOP Inventory  → .xlsx, by editing the embedded template at the XML
        level with JSZip (same approach as SLI/IPC/PL). Reuses PL's shared
        helpers (_plGetRow, _plReplaceExact, _plCloneRow, _plRenumberRows,
        _xmlEsc), which load first.
     2. TOP Cover Letter → .docx, assembled from scratch with JSZip from the
        DTRA body template, mirroring python-docx (Times New Roman 12pt,
        centered title lines, a numbered terms list, and a yellow-highlighted
        "(XX pages)").
   ========================================================================= */

/* ---- Program / project-name tables (port of the service constants) ---- */

const CTR_PROGRAM_OPTIONS = [
  "BTRP", "CSE", "GNS", "PPP", "PPP-U", "OAAC", "DSTR / SOSE",
];

const CTR_PROGRAM_TO_PROJECT_NAME = {
  "BTRP": "Biological Threat Reduction Program",
  "CSE": "Chemical Security & Elimination",
  "GNS": "Global Nuclear Security",
  "PPP": "Proliferation Prevention Program",
  "PPP-U": "Proliferation Prevention Program - Ukraine",
  "OAAC": "Other Assessments Administrative Costs",
  "DSTR / SOSE": "Delivery System Threat Reduction",
};

/* Partner country dropdown (port of ui/top_documents_dialog.PARTNER_COUNTRY_OPTIONS) */
const TOP_PARTNER_COUNTRY_OPTIONS = [
  "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda",
  "Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain",
  "Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia",
  "Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso",
  "Burundi","Cabo Verde","Cambodia","Cameroon","Canada","Central African Republic",
  "Chad","Chile","China","Colombia","Comoros","Congo, Democratic Republic of the",
  "Congo, Republic of the","Costa Rica","Cote d'Ivoire","Croatia","Cuba","Cyprus",
  "Czechia","Denmark","Djibouti","Dominica","Dominican Republic","Ecuador","Egypt",
  "El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji",
  "Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada",
  "Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras","Hungary","Iceland",
  "India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Jamaica","Japan",
  "Jordan","Kazakhstan","Kenya","Kiribati","Kuwait","Kyrgyzstan","Laos","Latvia",
  "Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg",
  "Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands",
  "Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia",
  "Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands",
  "New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway",
  "Oman","Pakistan","Palau","Panama","Papua New Guinea","Paraguay","Peru","Philippines",
  "Poland","Portugal","Qatar","Romania","Russia","Rwanda","Saint Kitts and Nevis",
  "Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino",
  "Sao Tome and Principe","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone",
  "Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa",
  "South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden",
  "Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste",
  "Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu",
  "Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay",
  "Uzbekistan","Vanuatu","Vatican City","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe",
];

/* Cover-letter body. Tokens (aaa…kkk) are replaced by string substitution,
   exactly as the desktop TOP_BODY_TEMPLATE does. Kept byte-for-byte so the
   wording, the numbered terms (8-space-indented blocks), and the centered
   title lines all reproduce. */
const TOP_BODY_TEMPLATE =
`Report of Transfer of U.S. Government Equipment and Materials from the U.S. Department of Defense 
To the aaa of the bbb, ccc.

Transfer of Property Number: ddd

This report is concluded between the Government of the United States of America and the Government of ccc (hereinafter referred to as \u201Cthe Participants\u201D) for the transfer of equipment and materials from the Defense Threat Reduction Agency (DTRA), operating under the U.S. Department of Defense as the Executive Agent for the United States, to the Government of ccc in support of the collaborative efforts between the Participants, and affirms that the equipment and materials listed in Attachment 1 (XX pages) are provided as gratuitous technical assistance for use by the Government of ccc under the eee with oversight by personnel of DTRA and fff.

The Government of the United States provided the equipment listed on Attachment 1 to ccc.  Upon execution of this report, the Government of ccc is to retain physical custody and ownership of the equipment listed in Attachment 1.

The Government of the United States will coordinate and execute appropriate export authorizations to provide the equipment listed on Attachment 1.  This transfer of ownership is subject to the following terms:

        The items and equipment listed in Attachment 1 are only for use by the ccc under the eee.  It is the intention of the Parties that the Government of the ccc will not re-export nor re-transfer title, possession, or control over the items and equipment provided pursuant to this Report, and will not permit the use of such items and equipment for purposes other than those for which they have been provided without the consent of DTRA.

        The items and equipment listed in Attachment 1 may be used by entities of the ccc under the eee with oversight by personnel of DTRA and fff. It is the intention of the Parties that the Government of the ccc will take all reasonable measures to ensure the security of items and equipment provided pursuant to this Report, ensure proper maintenance and sustainment throughout their useful lifecycle, and protect them from theft or seizure by, or conversion from the use of, anyone other than those designated by DTRA.

        It is the intention of the Parties that the Government of the ccc will ensure full accountability of the items throughout the duration of the operation, and continue accounting for technical assistance provided by DTRA.

        The Department of Defense, its personnel, its contractors, and subcontractors are not liable or responsible for damage of any type or sort caused during operation of the items and equipment listed in Attachment 1.  Upon transfer of ownership of the items and equipment in Attachment 1 to the Government of the ccc, the Government of the ccc intends to indemnify and hold harmless the Department of Defense, its personnel, its contractors, and subcontractors from any third party liability incurred in the use of such items and equipment.

        The Government of ccc intends to grant access to DTRA, or its designated representatives, to hhh during the period of this collaborative effort to test and examine the use of any equipment, supplies, materials, technology, or services provided by DTRA.  DTRA has the right to inspect, monitor, and assess all records and documents pertaining to the use of the items and equipment provided, as well as any additional supplies, material, technologies, trainings, or other services provided in conjunction with this Report up to three years after the end of the Program.

        In the event of inconsistency between any terms of this document and any translation into another language, the English language meaning shall control.

An inventory and transfer of equipment were performed on the items listed in Attachment 1 at the hhh on iii.

1)  jjj as procuring party for the Defense Threat Reduction Agency:

____________________________________________ /__________________

Signature                                                                         Date (day/month/year)

Releases the property in accordance with the above terms and conditions to:

2)  kkk.

____________________________________________ /__________________

Signature                                                                         Date (day/month/year)

As receiving participant for the Government of ccc.
`;

/* ---- Small helpers (ports of the service helpers) ---- */

/** Port of top_documents_service._num. */
function _topNum(v) {
  let s = (v === null || v === undefined ? "" : String(v)).replace(/,/g, "").replace(/\$/g, "").trim();
  if (!s) return 0.0;
  const n = parseFloat(s);
  if (Number.isFinite(n)) return n;
  let cleaned = "";
  for (const ch of s) if ((ch >= "0" && ch <= "9") || ch === "." || ch === "-") cleaned += ch;
  const c = parseFloat(cleaned);
  return Number.isFinite(c) ? c : 0.0;
}

/** Port of top_documents_service._wmtr_last5: concatenate digits, take last 5. */
function _topWmtrLast5(wmtr) {
  const digits = String(wmtr || "").replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(-5) : "";
}

/** Port of _format_top_number: must be exactly 5 digits → "TOP-TTI-#####". */
function _topFormatTopNumber(raw) {
  const s = String(raw || "").trim();
  if (!/^\d{5}$/.test(s)) {
    throw new Error("TOP Number must be exactly 5 digits (for example 10160).");
  }
  return `TOP-TTI-${s}`;
}

/** Non-throwing version for live previews. */
function _topFormatTopNumberSafe(raw) {
  const s = String(raw || "").trim();
  if (/^\d{5}$/.test(s)) return `TOP-TTI-${s}`;
  return s ? `TOP-TTI-${s}` : "TOP-TTI-_____";
}

function _topProjectName(program) {
  return CTR_PROGRAM_TO_PROJECT_NAME[String(program || "").trim()] || "";
}

/** Port of top_documents_service._party_block (raw fields → block string). */
function _topPartyBlock(raw, includePoc) {
  raw = raw || {};
  const city = norm(raw.city), state = norm(raw.state), zip = norm(raw.zip);
  const parts = [city, state, zip].filter((x) => normWs(x));
  let cityLine = parts.slice(0, 2).join(", ");
  if (parts.length >= 3) cityLine = cityLine ? `${cityLine} ${parts[2]}` : parts[2];

  const lines = [norm(raw.addr0), norm(raw.addr1), cityLine, cleanCountry(raw.country)]
    .filter((x) => normWs(x));
  if (includePoc && normWs(raw.poc_name)) lines.push(norm(raw.poc_name));
  return lines.join("\n").trim();
}

/* ---- Dialog defaults from a loaded Property UDQ (port of build_top_dialog_defaults) ---- */

function topBuildDefaults(data) {
  const meta = (data && data.meta) || {};
  const parties = (data && data.parties) || {};
  const uc = parties.consignee || {};
  const eu = parties.end_user || {};

  const program = meta.ctr_program || "";
  const partnerCountry = meta.partner_country ||
    cleanCountry(meta.country_destination || "");

  const institute = norm((uc.raw && uc.raw.org)) || norm((eu.raw && eu.raw.org));
  const siteLocation = _topPartyBlock(uc.raw) || _topPartyBlock(eu.raw);
  const partnerFacility = norm((uc.raw && uc.raw.org)) || norm((eu.raw && eu.raw.org));
  const partnerRep = norm((uc.raw && uc.raw.poc_name)) || norm((eu.raw && eu.raw.poc_name));

  const wmtr = meta.wmtr || "";
  const last5 = _topWmtrLast5(wmtr);

  return {
    partner_country: partnerCountry,
    top_number: last5,
    transfer_date: todayISO(),
    inventory_date: todayISO(),
    ctr_program: program,
    ctr_project_name: _topProjectName(program),
    ministry_agency: "",
    institute_name: institute,
    site_location: siteLocation,
    partner_facility: partnerFacility,
    contractor_name: "TechTrans Intl",
    contractor_poc: "Roger Huang, Senior Buyer",
    contractor_poc_phone: "+1 757 806-8828",
    contractor_poc_email: "RHuang@tti-corp.com",
    ctr_procuring_entity: "Roger Huang",
    partner_representative: partnerRep,
    wmtr_number: wmtr,
    wmtr_last5: last5,
  };
}

/* ---- Shared derived model from the form options ---- */

function topBuildModel(opts) {
  opts = opts || {};
  const program = norm(opts.ctr_program);
  const project = norm(opts.ctr_project_name);
  const projectDisplay = (project && program) ? `${project} (${program})`
    : (project || program);

  const topNumberDisplay = _topFormatTopNumberSafe(opts.top_number);

  const phoneEmail = [norm(opts.contractor_poc_phone), norm(opts.contractor_poc_email)]
    .filter(Boolean).join(" / ");

  return {
    ...opts,
    last5: norm(opts.top_number),
    top_number_display: topNumberDisplay,
    project_display: projectDisplay,
    contractor_poc_phone_email: phoneEmail,
    items: opts.items || [],
  };
}

/* ---- Quantity rendering (desktop writes int(round(qty)); 0 stays 0) ---- */
function _topQtyWhole(n) {
  const v = _topNum(n);
  return v ? Math.round(v) : 0;
}

/* =========================================================================
   TOP Inventory (.xlsx) — XML-level fill of the embedded template.

   Template map (sheet "Sheet1"):
     Header block (label in A/F, VALUE merged in B/H):
       B2 CTR Program   B3 Partner Country  B4 CTR Project Name
       B5 Ministry      B6 Institute        B7 Site/Location  B8 Partner Facility
       H2 TOP Number    H3 TOP Date         H4 Contractor     H5 Contractor POC
       H6 Contractor POC Phone/Email        H7 (fixed contract #, left as-is)
       H8 CTR Program Representative/COR/KO
     Row 9   column headers.
     Rows 10-26 item rows (template capacity 17). Per item row:
       A item #   C short desc   E long desc   F serial   G manufacturer
       I model    K quantity     L unit-of-measure   M item cost   N =K*M
       (B item-type, D translation, H mfr part#, J NSN, O remarks left blank)
     Row 27  total row (N = SUM of line costs).  Rows 28-30 footer; D30 inv date.
     More than 17 items → extra rows cloned from row 26 and inserted before the
     total row (mirrors openpyxl insert_rows at row 27).
   ========================================================================= */

const TOP_ITEM_START = 10;
const TOP_TEMPLATE_CAP = 17;
const TOP_ITEM_TPL_LAST = 26;
const TOP_TOTAL_ROW = 27;

/** Cell setter that preserves the template style. kind: "inline" | "num" | "formula". */
function _topSetCell(rowXml, addr, value, kind) {
  const cellRe = new RegExp(`<c [^>]*\\br="${addr}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
  const existM = rowXml.match(cellRe);
  let style = "0";
  if (existM) {
    const sm = existM[0].match(/\bs="(\d+)"/);
    if (sm) style = sm[1];
  } else {
    const rm = rowXml.match(/\bs="(\d+)"/);
    if (rm) style = rm[1];
  }

  let newCell;
  if (kind === "num") {
    newCell = `<c r="${addr}" s="${style}"><v>${value}</v></c>`;
  } else if (kind === "formula") {
    newCell = `<c r="${addr}" s="${style}"><f>${_xmlEsc(String(value))}</f></c>`;
  } else {
    const esc = _xmlEsc(String(value)).replace(/\n/g, "&#10;");
    newCell = `<c r="${addr}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc}</t></is></c>`;
  }

  if (existM) return _plReplaceExact(rowXml, existM[0], newCell);
  return rowXml.replace("</row>", newCell + "</row>");
}

/** Fill an item row's data cells (everything except the N formula). */
function _topFillItemRow(rowXml, r, item) {
  item = item || {};
  let rx = rowXml;
  rx = _topSetCell(rx, `A${r}`, String(item.item_no != null ? item.item_no : ""), item.item_no != null ? "num" : "inline");
  rx = _topSetCell(rx, `C${r}`, norm(item.desc), "inline");
  rx = _topSetCell(rx, `E${r}`, norm(item.desc), "inline");
  rx = _topSetCell(rx, `F${r}`, norm(item.serial), "inline");
  rx = _topSetCell(rx, `G${r}`, norm(item.mfr), "inline");
  rx = _topSetCell(rx, `I${r}`, norm(item.model), "inline");
  rx = _topSetCell(rx, `L${r}`, norm(item.uom), "inline");
  rx = _topSetCell(rx, `K${r}`, String(_topQtyWhole(item.qty)), "num");
  rx = _topSetCell(rx, `M${r}`, String(_topNum(item.unit_value)), "num");
  return rx;
}

/** Blank an item row's data cells (used for unused template rows when < 17 items). */
function _topBlankItemRow(rowXml, r) {
  let rx = rowXml;
  for (const col of ["A", "C", "E", "F", "G", "I", "K", "L", "M"]) {
    rx = _topSetCell(rx, `${col}${r}`, "", "inline");
  }
  return rx;
}

function topInventoryEditWorkbookParts(parts, model) {
  let xml = parts.sheet;
  const items = model.items || [];
  const n = items.length;
  const extra = Math.max(0, n - TOP_TEMPLATE_CAP);

  const editRow = (r, fn) => {
    const rowXml = _plGetRow(xml, r);
    if (!rowXml) return;
    xml = _plReplaceExact(xml, rowXml, fn(rowXml));
  };

  // 1) Header values (rows 2-8). H7 (contract #) intentionally untouched.
  const hv = {
    B2: norm(model.ctr_program),
    B3: norm(model.partner_country),
    B4: norm(model.ctr_project_name),
    B5: norm(model.ministry_agency),
    B6: norm(model.institute_name),
    B7: norm(model.site_location),
    B8: norm(model.partner_facility),
    H2: model.top_number_display,
    H3: norm(model.transfer_date),
    H4: norm(model.contractor_name),
    H5: norm(model.contractor_poc),
    H6: norm(model.contractor_poc_phone_email),
    H8: norm(model.ctr_procuring_entity),
  };
  for (let r = 2; r <= 8; r++) {
    editRow(r, (rx) => {
      if (hv[`B${r}`] !== undefined) rx = _topSetCell(rx, `B${r}`, hv[`B${r}`], "inline");
      if (hv[`H${r}`] !== undefined) rx = _topSetCell(rx, `H${r}`, hv[`H${r}`], "inline");
      return rx;
    });
  }

  // 2) Fill the in-place item rows (10 .. min(n,17)+9)
  const inPlace = Math.min(n, TOP_TEMPLATE_CAP);
  for (let i = 0; i < inPlace; i++) {
    const r = TOP_ITEM_START + i;
    editRow(r, (rx) => _topFillItemRow(rx, r, items[i]));
  }

  // 3a) Fewer than capacity → blank the unused template rows (keeps the block)
  if (n < TOP_TEMPLATE_CAP) {
    for (let r = TOP_ITEM_START + n; r <= TOP_ITEM_TPL_LAST; r++) {
      editRow(r, (rx) => _topBlankItemRow(rx, r));
    }
  }

  // 3b) More than capacity → clone row 26 `extra` times, insert before total row
  if (extra > 0) {
    let tempBase = 9000;
    for (let i = 0; i < extra; i++) {
      const tRow = tempBase++;
      const clone = _plCloneRow(xml, TOP_ITEM_TPL_LAST, tRow);
      if (!clone) continue;
      const anchor = _plGetRow(xml, TOP_TOTAL_ROW);   // total row, still at 27 pre-renumber
      if (!anchor) continue;
      const at = xml.indexOf(anchor);
      xml = xml.slice(0, at) + clone + xml.slice(at);
      const tRowXml = _plGetRow(xml, tRow);
      if (tRowXml) {
        xml = _plReplaceExact(xml, tRowXml, _topFillItemRow(tRowXml, tRow, items[TOP_TEMPLATE_CAP + i]));
      }
    }
  }

  // 4) Renumber every row sequentially in document order.
  xml = _plRenumberRows(xml);

  // 5) Now that final row numbers are settled, (re)write the N-column formulas.
  //    Every item row 10..(9+n) → =K{r}*M{r}; total row → =SUM(N10:N{9+n}).
  const lastItemRow = TOP_ITEM_START + n - 1;          // 9 + n
  const totalRow = TOP_TOTAL_ROW + extra;              // 27 + extra
  const fmtMax = Math.max(lastItemRow, TOP_ITEM_TPL_LAST); // also blank rows when n<17
  for (let r = TOP_ITEM_START; r <= fmtMax; r++) {
    if (r >= totalRow) break;
    editRow(r, (rx) => _topSetCell(rx, `N${r}`, `K${r}*M${r}`, "formula"));
  }
  editRow(totalRow, (rx) => _topSetCell(rx, `N${totalRow}`, `SUM(N${TOP_ITEM_START}:N${lastItemRow})`, "formula"));

  // 6) Inventory date → D of the (shifted) inventory-date footer row (orig row 30).
  const invDateRow = 30 + extra;
  if (normWs(model.inventory_date)) {
    editRow(invDateRow, (rx) => _topSetCell(rx, `D${invDateRow}`, norm(model.inventory_date), "inline"));
  }

  // 7) Shift footer merges (rows ≥ 28) down by `extra`; header merges unchanged.
  if (extra > 0) {
    xml = xml.replace(/<mergeCells[^>]*>[\s\S]*?<\/mergeCells>/, (full) =>
      full.replace(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g, (_, c1, r1, c2, r2) => {
        const n1 = parseInt(r1, 10), n2 = parseInt(r2, 10);
        const s1 = n1 >= 28 ? n1 + extra : n1;
        const s2 = n2 >= 28 ? n2 + extra : n2;
        return `<mergeCell ref="${c1}${s1}:${c2}${s2}"/>`;
      })
    );
  }

  // 8) Dimension grows with the inserted rows.
  const finalBottom = 30 + extra;
  xml = xml.replace(/(<dimension ref="A1:)[A-Z]+\d+(")/, (_, pre, suf) => `${pre}O${finalBottom}${suf}`);

  return { sheet: xml };
}

async function topInventoryWriteWorkbook(model) {
  if (typeof JSZip === "undefined") throw new Error("JSZip isn't loaded on this page");
  const bin = atob(TOP_INVENTORY_TEMPLATE_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const zip = await JSZip.loadAsync(bytes);

  const parts = { sheet: await zip.file("xl/worksheets/sheet1.xml").async("string") };
  const edited = topInventoryEditWorkbookParts(parts, model);

  const outZip = new JSZip();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (name === "xl/worksheets/sheet1.xml") outZip.file(name, edited.sheet);
    else outZip.file(name, await entry.async("uint8array")); // styles, theme, logo, etc. verbatim
  }
  return await outZip.generateAsync({ type: "base64" });
}

function topInventoryName(model) {
  const tn = _topFormatTopNumberSafe(model.last5 || model.top_number).replace(/_/g, "");
  return `${tn}_inventory_${fileStamp()}.xlsx`;
}

/* =========================================================================
   TOP Cover Letter (.docx) — assembled from scratch with JSZip.

   Mirrors services/top_documents_service.build_top_cover_doc / python-docx:
     - Normal style = Times New Roman 12pt; 1-inch margins all around.
     - Body split on blank lines; the two opening title lines are centered;
       the 8-space-indented blocks become a numbered terms list (1., 2., …)
       with a 0.25-inch tab; "(XX pages)" is highlighted yellow.
     - Within a run, "\n" → line break and "\t" → tab (python-docx semantics).
   ========================================================================= */

/** Token map (port of run_top_cover_pipeline values), applied in order. */
function topCoverValues(model) {
  return {
    aaa: norm(model.institute_name),
    bbb: norm(model.ministry_agency),
    ccc: norm(model.partner_country),
    ddd: model.top_number_display,
    eee: model.project_display,
    fff: norm(model.contractor_name),
    hhh: norm(model.site_location),
    iii: norm(model.transfer_date),
    jjj: norm(model.ctr_procuring_entity),
    kkk: norm(model.partner_representative),
  };
}

function topCoverFilledText(model) {
  let text = TOP_BODY_TEMPLATE;
  for (const [token, value] of Object.entries(topCoverValues(model))) {
    text = text.split(token).join(value);
  }
  return text;
}

/** Parse the filled body into structured paragraph descriptors (shared by
    the .docx builder and the HTML preview). */
function topCoverParagraphs(model) {
  const text = topCoverFilledText(model);
  const blocks = text.split("\n\n");
  const out = [];
  let listCounter = 0;
  for (const block of blocks) {
    if (!block.trim()) { out.push({ kind: "blank" }); continue; }
    if (block.startsWith("        ")) {
      listCounter += 1;
      out.push({ kind: "list", number: listCounter, text: block.trim() });
      continue;
    }
    if (block.indexOf("(XX pages)") !== -1) {
      const idx = block.indexOf("(XX pages)");
      out.push({ kind: "highlight", before: block.slice(0, idx), after: block.slice(idx + "(XX pages)".length) });
      continue;
    }
    const stripped = block.trim();
    const center = stripped.startsWith("Report of Transfer of U.S. Government Equipment") ||
                   stripped.startsWith("To the");
    out.push({ kind: "para", text: block, center });
  }
  return out;
}

/* ---- .docx XML assembly ---- */

function _topDocxEsc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** One <w:r> with "\n"→<w:br/> and "\t"→<w:tab/>; optional rPr XML. */
function _topRunXml(textVal, rPrXml) {
  let inner = rPrXml || "";
  const re = /(\n|\t)/g;
  let last = 0, m;
  const push = (seg) => {
    if (seg) inner += `<w:t xml:space="preserve">${_topDocxEsc(seg)}</w:t>`;
  };
  while ((m = re.exec(textVal)) !== null) {
    push(textVal.slice(last, m.index));
    inner += (m[1] === "\n") ? "<w:br/>" : "<w:tab/>";
    last = m.index + 1;
  }
  push(textVal.slice(last));
  return `<w:r>${inner}</w:r>`;
}

function _topCoverDocumentXml(model) {
  const paras = topCoverParagraphs(model);
  const body = paras.map((p) => {
    if (p.kind === "blank") return "<w:p/>";
    if (p.kind === "list") {
      const pPr = `<w:pPr><w:ind w:left="0" w:firstLine="0"/><w:tabs><w:tab w:val="left" w:pos="360"/></w:tabs></w:pPr>`;
      return `<w:p>${pPr}${_topRunXml(`${p.number}.\t${p.text}`)}</w:p>`;
    }
    if (p.kind === "highlight") {
      const hi = `<w:rPr><w:highlight w:val="yellow"/></w:rPr>`;
      return `<w:p>${_topRunXml(p.before)}${_topRunXml("(XX pages)", hi)}${_topRunXml(p.after)}</w:p>`;
    }
    const pPr = p.center ? `<w:pPr><w:jc w:val="center"/></w:pPr>` : "";
    return `<w:p>${pPr}${_topRunXml(p.text)}</w:p>`;
  }).join("");

  const sectPr = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
    `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}${sectPr}</w:body></w:document>`;
}

const _TOP_DOCX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const _TOP_DOCX_ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const _TOP_DOCX_DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const _TOP_DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style></w:styles>`;

async function topCoverBuildDocxBlob(model) {
  if (typeof JSZip === "undefined") throw new Error("JSZip isn't loaded on this page");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", _TOP_DOCX_CONTENT_TYPES);
  zip.folder("_rels").file(".rels", _TOP_DOCX_ROOT_RELS);
  const word = zip.folder("word");
  word.file("document.xml", _topCoverDocumentXml(model));
  word.file("styles.xml", _TOP_DOCX_STYLES);
  word.folder("_rels").file("document.xml.rels", _TOP_DOCX_DOC_RELS);
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function topCoverName(model) {
  const tn = _topFormatTopNumberSafe(model.last5 || model.top_number).replace(/_/g, "");
  return `${tn}_cover_${fileStamp()}.docx`;
}

/* =========================================================================
   HTML previews (mirror the generated .docx / .xlsx; shown in the workspace
   iframes). These are display-only and never affect the produced files.
   ========================================================================= */

const _TOP_PREVIEW_CSS = `
  :root{ color-scheme: light; }
  *{ box-sizing:border-box; }
  body{ margin:0; background:#fff; color:#111;
        font-family:"Times New Roman", Georgia, serif; }
  .page{ max-width:8.5in; margin:0 auto; padding:0.6in 0.7in; font-size:12pt; line-height:1.3; }
  .page p{ margin:0 0 11px; white-space:pre-wrap; }
  .page p.center{ text-align:center; }
  .page p.list{ margin:0 0 11px; padding-left:1.6em; text-indent:-1.6em; white-space:pre-wrap; }
  .page .hl{ background:#fff14d; }
  .ph{ color:#b00; background:#fff0f0; padding:0 2px; border-radius:2px; font-style:italic; }
  /* inventory */
  .inv{ font-family: Arial, Helvetica, sans-serif; color:#111; padding:14px 16px; font-size:12px; }
  .inv h3{ margin:0 0 8px; font-size:13px; }
  .inv .hdr{ display:grid; grid-template-columns:1fr 1fr; gap:2px 26px; margin-bottom:12px; }
  .inv .hdr .row{ display:flex; gap:6px; padding:2px 0; border-bottom:1px solid #eee; }
  .inv .hdr .k{ color:#555; min-width:150px; }
  .inv .hdr .v{ font-weight:600; white-space:pre-line; }
  .inv table{ border-collapse:collapse; width:100%; font-size:11px; }
  .inv th,.inv td{ border:1px solid #cfcfcf; padding:3px 5px; text-align:left; vertical-align:top; }
  .inv th{ background:#f2f2f2; font-weight:600; }
  .inv td.num{ text-align:right; font-variant-numeric:tabular-nums; }
  .inv tr.total td{ font-weight:700; background:#fafafa; }
`;

/** HTML preview of the TOP cover letter (mirrors topCoverParagraphs output). */
function topCoverRenderHtml(model) {
  const esc2 = (typeof esc === "function") ? esc : (s) =>
    String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = topCoverParagraphs(model);
  const body = paras.map((p) => {
    if (p.kind === "blank") return "<p>&nbsp;</p>";
    if (p.kind === "list") return `<p class="list">${esc2(p.number + ".\t" + p.text)}</p>`;
    if (p.kind === "highlight")
      return `<p>${esc2(p.before)}<span class="hl">(XX pages)</span>${esc2(p.after)}</p>`;
    return `<p class="${p.center ? "center" : ""}">${esc2(p.text)}</p>`;
  }).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${_TOP_PREVIEW_CSS}</style></head>` +
    `<body><div class="page">${body}</div></body></html>`;
}

/** HTML preview of the TOP inventory sheet (mirrors the .xlsx fill). */
function topInventoryRenderHtml(model) {
  const esc2 = (typeof esc === "function") ? esc : (s) =>
    String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const items = model.items || [];
  const money = (typeof fmtMoney === "function")
    ? (n) => fmtMoney(n)
    : (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ph = (s) => s ? esc2(s) : `<span class="ph">—</span>`;

  const hdrRows = [
    ["CTR Program", model.ctr_program, "TOP Number", model.top_number_display],
    ["Partner Country", model.partner_country, "TOP Date", model.transfer_date],
    ["CTR Project Name", model.ctr_project_name, "Contractor", model.contractor_name],
    ["Ministry / Agency", model.ministry_agency, "Contractor POC", model.contractor_poc],
    ["Institute", model.institute_name, "Contractor POC Phone/Email", model.contractor_poc_phone_email],
    ["Site / Location", model.site_location, "Contract #", "HDTRA125D0002"],
    ["Partner Facility", model.partner_facility, "CTR Program Representative", model.ctr_procuring_entity],
  ];
  const hdrHtml = hdrRows.map(([k1, v1, k2, v2]) =>
    `<div class="row"><span class="k">${esc2(k1)}</span><span class="v">${ph(v1)}</span></div>` +
    `<div class="row"><span class="k">${esc2(k2)}</span><span class="v">${ph(v2)}</span></div>`
  ).join("");

  let total = 0;
  const itemRows = items.map((it, i) => {
    const qty = Math.round(Number(it.qty) || 0);
    const cost = Number(it.unit_value) || 0;
    const line = qty * cost;
    total += line;
    return `<tr>
      <td class="num">${i + 1}</td>
      <td>${esc2(it.desc || "")}</td>
      <td>${esc2(it.serial || "")}</td>
      <td>${esc2(it.mfr || "")}</td>
      <td>${esc2(it.model || "")}</td>
      <td>${esc2(it.uom || "")}</td>
      <td class="num">${qty}</td>
      <td class="num">${money(cost)}</td>
      <td class="num">${money(line)}</td>
    </tr>`;
  }).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>${_TOP_PREVIEW_CSS}</style></head>
<body><div class="inv">
  <h3>TOP Inventory Sheet</h3>
  <div class="hdr">${hdrHtml}</div>
  <table>
    <thead><tr>
      <th>#</th><th>Description</th><th>Serial #</th><th>Manufacturer</th>
      <th>Model / Catalog #</th><th>UOM</th><th>Qty</th><th>Unit cost</th><th>Total</th>
    </tr></thead>
    <tbody>
      ${itemRows || `<tr><td colspan="9" style="text-align:center;color:#888;">No inventory rows</td></tr>`}
      <tr class="total"><td colspan="8" style="text-align:right;">Total Cost</td><td class="num">${money(total)}</td></tr>
    </tbody>
  </table>
  <div style="margin-top:10px;color:#555;">Inventory Date: <b>${esc2(model.inventory_date || "")}</b></div>
</div></body></html>`;
}
