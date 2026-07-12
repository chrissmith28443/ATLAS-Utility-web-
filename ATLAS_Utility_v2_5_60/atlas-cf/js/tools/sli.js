/* =========================================================================
   ATLAS Utility Web — tools/sli.js
   Shipper's Letter of Instruction (SLI) generator.

   FAITHFUL PORT of the desktop v4.4 SLI:
     - services/sli_service.py        (run_sli_pipeline: hazmat, party blocks,
                                        embassy intermediate, $2,500 HTS-group
                                        threshold, USML/ECCN qty routing, A19)
     - services/sli_excel_writer.py   (write_sli_with_excel_dynamic: cell map,
                                        dynamic item rows, checkboxes, highlight)
     - templates/SLI_Template.xlsx    (embedded as base64 in sli_template.js)

   Output is an .xlsx (like the desktop), produced entirely in the browser by
   editing the template at the XML level with JSZip — the same approach the PL
   tool uses. Reuses PL's shared XML helpers (_plCloneRow,
   _plRenumberRows, PlStringTable, _plGetRow, _plReplaceExact, _xmlEsc), which
   load before this file.

   Template cell map (sheet "SLI Portrait v.2.3_032717"):
     E3  Freight Location name        E5  Freight Location address (E5:I7)
     J3  Forwarding Agent (name+addr, J3:M7)
     A11 Ultimate consignee (A11:D14) J11 Intermediate consignee (J11:M14, embassy only)
     C15 State of origin (C15:F15)    C16 Country of destination (C16:F16)
     A19 WMTR reference statement (A19:M19)
     C17 Hazmat YES (checkbox)        E17 Hazmat NO (checkbox)
     Items rows 22-24 (expandable):   A df, B HTS, C desc, D qty(ECCN),
       E qty(USML), F weight(blank), G ECCN, H SME(blank), I:K license, L value, M (blank)
     B26 "remaining non-licensable <= $2,500 not listed" checkbox (shifts with items)
     M31 Signature date (Box 42)
   ========================================================================= */

/* ---- Small ports of desktop helpers (party_utils / export_control) ---- */

function _sliPartyBlock(party) {
  if (!party) return "";
  const lines = [];
  for (const a of (party.addr_lines || [])) {
    const s = norm(a);
    if (s) lines.push(s);
  }
  const country = norm(party.country);
  if (country && !lines.some((ln) => ln.toLowerCase() === country.toLowerCase())) {
    lines.push(country);
  }
  return lines.join("\n").trim();
}

function _sliPocLine(party) {
  if (!party) return "";
  return [norm(party.contact), norm(party.email), norm(party.phone)]
    .filter(Boolean).join(", ").trim();
}

function _sliPartyBlockWithPoc(party) {
  const base = _sliPartyBlock(party);
  const poc = _sliPocLine(party);
  if (base && poc) return base + "\n" + poc;
  return base || poc || "";
}

/** Port of party_utils.extract_state_from_address. */
function _sliExtractState(block) {
  if (!block) return "";
  const lines = block.split(/\n/).map((s) => s.trim()).filter(Boolean);
  const tail = lines.slice(-2).join(" ") || block;
  const m = tail.match(/\b([A-Z]{2})\b/);
  return m ? m[1] : "";
}

/** Port of export_control.classify_ctrl -> [normalized, isUsml]. */
function _sliClassifyCtrl(raw) {
  const s = (raw || "").trim();
  if (!s) return ["EAR99", false];
  const up = s.toUpperCase().replace(/ /g, "");
  if (["EAR99", "NLR", "N/A", "N_A"].includes(up)) return [up, false];
  if (up.startsWith("USML")) {
    const rest = up.slice(4).replace(/^[:\-]+/, "").trim();
    return [rest || up, true];
  }
  if (/^[0-9][A-Z][0-9]{3}/.test(up)) return [up, false];
  return [up, true];
}

/** Port of the SLI _num() money/number parser. */
function _sliNum(x) {
  if (x === null || x === undefined) return 0.0;
  let s = String(x).trim();
  if (!s) return 0.0;
  s = s.replace(/,/g, "").replace(/\$/g, "");
  if (s.startsWith("(") && s.endsWith(")")) s = "-" + s.slice(1, -1).trim();
  let n = parseFloat(s);
  if (Number.isFinite(n)) return n;
  const cleaned = s.replace(/[^0-9.\-]/g, "");
  n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0.0;
}

/** Port of _fmt_qty: whole numbers as integers, else trimmed decimals. */
function _sliFmtQty(v) {
  const q = Number(v);
  if (!Number.isFinite(q)) return "";
  if (Math.abs(q - Math.round(q)) < 1e-9) return String(Math.round(q));
  return q.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/* ---- Model builder: faithful port of run_sli_pipeline (minus Excel I/O) ---- */

function sliBuildModel(data, opts) {
  opts = opts || {};
  const meta = data.meta || {};
  const parties = data.parties || {};
  const items = data.items || [];

  const freightSel = (opts.freightSel || "").trim();
  const forwardSel = (opts.forwardSel || "").trim();
  const sigDate = (opts.sigDate || "").trim();

  const highlightCells = [];

  // Freight Location (E3 name, E5 address)
  let freightName, freightAddr;
  if (freightSel === "Other (manual)" || !freightSel) {
    freightName = ""; freightAddr = "";
    highlightCells.push("E3", "E5");
  } else {
    freightName = freightSel;
    freightAddr = (SLI_LOCATIONS[freightName] || freightName).trim();
  }

  // Forwarding Agent (J3 name+addr)
  let fwdName, fwdAddr;
  if (forwardSel === "Other (manual)" || !forwardSel) {
    fwdName = ""; fwdAddr = "";
    highlightCells.push("J3");
  } else {
    fwdName = forwardSel;
    fwdAddr = (SLI_LOCATIONS[fwdName] || fwdName).trim();
  }

  // Party blocks
  const consignee = parties.consignee;
  const deliver = parties.deliver || parties.deliver_to;

  const consigneeBlock = consignee ? _sliPartyBlockWithPoc(consignee) : "";
  let deliverBlock = deliver ? _sliPartyBlockWithPoc(deliver) : "";

  // Append Delivery Destination POC to deliver block if not already present
  const ddPoc = deliver
    ? [norm(deliver.contact), norm(deliver.email), norm(deliver.phone)].filter(Boolean).join(", ").trim()
    : "";
  if (ddPoc && !(deliverBlock || "").toLowerCase().includes(ddPoc.toLowerCase())) {
    deliverBlock = deliverBlock ? (deliverBlock + "\n" + ddPoc) : ddPoc;
  }

  const consigneeHasEmbassy = (consigneeBlock || "").toUpperCase().includes("EMBASSY");
  const a11 = deliverBlock || consigneeBlock;            // ultimate consignee
  const j11 = consigneeHasEmbassy ? consigneeBlock : ""; // intermediate (embassy only)

  const deliverCountry = deliver ? norm(deliver.country) : "";

  // State of origin (C15): full state name from freight address; blank if Other
  let freightState = "";
  if (freightSel === "Other (manual)" || !freightSel) {
    highlightCells.push("C15");
    freightState = "";
  } else {
    const abbr = _sliExtractState(freightAddr);
    freightState = US_STATE_FULL[abbr.toUpperCase()] || abbr;
  }

  // A19 WMTR reference statement.
  const wmtrFull = (meta.invoice_no || meta.wmtr || "").trim();
  const _sliSecW = (meta._consol_secondaries || []);
  const wmtrRef = _sliSecW.length
    ? `${wmtrFull} (consolidated with ${_sliSecW.join(", ")})`
    : wmtrFull;
  const a19 = `${wmtrRef} must be referenced on all documents (AWB, customs Bayan, POD) related to this shipment.`;

  // Hazmat: DG = YES if any item's UN Code contains a digit OR the literal "UN"
  let hazmatYes = false;
  for (const it of items) {
    const un = norm(it.un_code).toUpperCase();
    if (!un) continue;
    if (/[0-9]/.test(un) || un.includes("UN")) { hazmatYes = true; break; }
  }

  const isNonLic = (eccnNorm, isUsml, hasRealAuth) =>
    (!isUsml) && ["EAR99", "NLR", "N/A", "N_A"].includes(eccnNorm) && (!hasRealAuth);

  // Pass 1: per-HTS totals for non-licensable items
  const nonlic = {};
  for (const it of items) {
    const hts = norm(it.hts);
    if (!hts) continue;
    const [eccnNorm, isUsml] = _sliClassifyCtrl(norm(it.eccn));
    const authUp = norm(it.auth).toUpperCase();
    const hasRealAuth = !!(authUp && authUp !== "NLR" && authUp !== "NO LICENSE REQUIRED");
    if (isNonLic(eccnNorm, isUsml, hasRealAuth)) {
      const val = _sliNum(it.total_value) || (_sliNum(it.unit_value) * _sliNum(it.units));
      nonlic[hts] = (nonlic[hts] || 0) + val;
    }
  }

  // Pass 2: group into SLI line rows
  const SEP = "\u0001";
  const lineMap = {};
  for (const it of items) {
    const desc = norm(it.desc);
    const uom = norm(it.uom);
    const hts = norm(it.hts);
    if (!hts) continue;

    const auth = norm(it.auth);
    const coo = norm(it.coo).toUpperCase();
    const df = (coo && !US_COO.includes(coo)) ? "F" : "D";
    const [eccnNorm, isUsml] = _sliClassifyCtrl(norm(it.eccn));
    const authUp = auth.toUpperCase();
    const hasRealAuth = !!(authUp && authUp !== "NLR" && authUp !== "NO LICENSE REQUIRED");

    // Listing rule: drop EAR99/NLR-with-no-auth lines whose HTS group totals <= $2,500
    if (isNonLic(eccnNorm, isUsml, hasRealAuth)) {
      if ((nonlic[hts] || 0) <= 2500.0) continue;
    }

    const licNorm = (auth || "NLR").trim();
    const key = [df, hts, eccnNorm, licNorm].join(SEP);

    if (!(key in lineMap)) {
      lineMap[key] = {
        df, hts, desc: "", __count: 0,
        qty: 0, __qty_uom: "", ddtc_qty_uom: "", __ddtc_qty: 0, __ddtc_uom: "",
        weight_kg: null, eccn: eccnNorm, sme: "", license: licNorm, value: 0, license_value: "",
      };
    }
    const row = lineMap[key];
    if (desc && !row.desc) row.desc = desc;
    row.__count += 1;

    const qty = _sliNum(it.units);
    const val = _sliNum(it.total_value) || (_sliNum(it.unit_value) * qty);
    row.value += val;

    if (isUsml) {
      row.__ddtc_qty += qty;
      if (!row.__ddtc_uom) row.__ddtc_uom = uom;
    } else {
      row.qty += qty;
      if (!row.__qty_uom) row.__qty_uom = uom;
    }
  }

  const remaining2500 = Object.values(nonlic).some((t) => t > 0 && t <= 2500.0);

  // Sort by (hts, df, eccn, license) — matches desktop tuple sort
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const orderedKeys = Object.keys(lineMap).sort((a, b) => {
    const A = a.split(SEP), B = b.split(SEP);
    return cmp(A[1], B[1]) || cmp(A[0], B[0]) || cmp(A[2], B[2]) || cmp(A[3], B[3]);
  });

  const lineRows = orderedKeys.map((k) => {
    const row = Object.assign({}, lineMap[k]);
    row.__highlight_sme = row.__ddtc_qty > 0;
    row.__highlight_desc = row.__count > 1;

    // D column (ECCN qty) — blank when USML present
    if (row.__ddtc_qty > 0) {
      row.qty = "";
    } else {
      const q = _sliFmtQty(row.qty);
      row.qty = q ? `${q} ${(row.__qty_uom || "").trim()}`.trim() : "";
    }
    // E column (USML qty)
    if (row.__ddtc_qty > 0) {
      const q = _sliFmtQty(row.__ddtc_qty);
      row.ddtc_qty_uom = q ? `${q} ${(row.__ddtc_uom || "").trim()}`.trim() : "";
    } else {
      row.ddtc_qty_uom = "";
    }
    row.value = Number(row.value) || 0;
    return row;
  });

  const headerValues = {
    E3: freightName,
    E5: freightAddr,
    J3: (fwdName || fwdAddr) ? `${fwdName}\n${fwdAddr}`.trim() : "",
    A11: a11,
    J11: j11 || "",
    C15: freightState,
    C16: deliverCountry,
    A19: a19,
  };
  if (sigDate) headerValues.M31 = sigDate;

  return {
    headerValues, lineRows, hazmatYes, remaining2500, highlightCells,
    summary: {
      freightName: freightName || "(manual entry)",
      fwdName: fwdName || "(manual entry)",
      a11FirstLine: (a11 || "").split("\n")[0] || "(none)",
      embassyIntermediate: !!j11,
      hazmatYes, lineCount: lineRows.length, remaining2500,
    },
  };
}

/* ---- Excel-XML helpers specific to SLI (booleans + yellow highlight) ---- */

/**
 * Set/replace a single cell in a row's XML, preserving its style index.
 * Unlike the shared PL helper, the quantifier before the self-closing test is
 * LAZY (`[^>]*?`), so a self-closing `<c .../>` is matched exactly instead of
 * the match running on to the next `</c>` and deleting the cells in between.
 * type: "inline" multiline text | "s" shared-string index | "n"/"" number.
 */
function _sliSetCell(rowXml, addr, value, type) {
  let cellContent, typeAttr;
  if (type === "inline") {
    const esc = _xmlEsc(String(value)).replace(/\n/g, "&#10;");
    cellContent = `<is><t xml:space="preserve">${esc}</t></is>`;
    typeAttr = ` t="inlineStr"`;
  } else if (type === "s") {
    cellContent = `<v>${value}</v>`; typeAttr = ` t="s"`;
  } else {
    cellContent = `<v>${value}</v>`; typeAttr = ``;
  }
  const cellRe = new RegExp(`<c [^>]*\\br="${addr}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
  const existM = rowXml.match(cellRe);
  let style = "10";
  if (existM) {
    const sm = existM[0].match(/\bs="(\d+)"/);
    if (sm) style = sm[1];
  } else {
    const rm = rowXml.match(/\bs="(\d+)"/);
    if (rm) style = rm[1];
  }
  const newCell = `<c r="${addr}" s="${style}"${typeAttr}>${cellContent}</c>`;
  if (existM) return _plReplaceExact(rowXml, existM[0], newCell);
  return rowXml.replace("</row>", newCell + "</row>");
}

function _sliSetBool(rowXml, addr, val) {
  const cellRe = new RegExp(`<c [^>]*\\br="${addr}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
  const m = rowXml.match(cellRe);
  let style = "0";
  if (m) {
    const sm = m[0].match(/\bs="(\d+)"/);
    if (sm) style = sm[1];
  }
  const newCell = `<c r="${addr}" s="${style}" t="b"><v>${val ? 1 : 0}</v></c>`;
  if (m) return _plReplaceExact(rowXml, m[0], newCell);
  return rowXml.replace("</row>", newCell + "</row>");
}

function _sliFillItemRow(rowXml, r, item, st) {
  item = item || {};
  let rx = rowXml;
  rx = _sliSetCell(rx, `A${r}`, item.df || "", "inline");
  rx = _sliSetCell(rx, `B${r}`, item.hts || "", "inline");
  rx = _sliSetCell(rx, `C${r}`, item.desc || "", "inline");
  rx = _sliSetCell(rx, `D${r}`, item.qty || "", "inline");
  rx = _sliSetCell(rx, `E${r}`, item.ddtc_qty_uom || "", "inline");
  rx = _sliSetCell(rx, `F${r}`, "", "inline");                 // weight intentionally blank
  rx = _sliSetCell(rx, `G${r}`, item.eccn || "", "inline");
  rx = _sliSetCell(rx, `H${r}`, item.sme || "", "inline");     // SME blank
  rx = _sliSetCell(rx, `I${r}`, item.license || "", "inline"); // merged I:K
  const hasVal = item.value !== "" && item.value != null && Number.isFinite(Number(item.value));
  rx = hasVal ? _sliSetCell(rx, `L${r}`, Number(item.value), "n")
              : _sliSetCell(rx, `L${r}`, "", "inline");
  rx = _sliSetCell(rx, `M${r}`, item.license_value || "", "inline");
  return rx;
}

/** Append a solid-yellow fill to styles.xml; returns {styles, fillId}. */
function _sliAddYellowFill(stylesXml) {
  const m = stylesXml.match(/<fills count="(\d+)">/);
  const count = m ? parseInt(m[1], 10) : 0;
  const fillXml =
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>';
  let styles = stylesXml.replace(/(<fills count=")(\d+)(">)/, (_, a, c, b) => a + (count + 1) + b);
  styles = styles.replace("</fills>", fillXml + "</fills>");
  return { styles, fillId: count };
}

function _sliNthXf(cellXfsInner, idx) {
  const re = /<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g;
  let m, i = 0;
  while ((m = re.exec(cellXfsInner)) !== null) { if (i === idx) return m[0]; i++; }
  return null;
}

/** Clone cellXfs[baseIdx] with the yellow fill applied; returns {styles, newIdx}. */
function _sliCloneXfYellow(stylesXml, baseIdx, fillId) {
  const sec = stylesXml.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  if (!sec) return { styles: stylesXml, newIdx: baseIdx };
  const count = parseInt(sec[1], 10);
  let baseXf = _sliNthXf(sec[2], baseIdx) || '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>';
  let newXf = /\bfillId="\d+"/.test(baseXf)
    ? baseXf.replace(/\bfillId="\d+"/, `fillId="${fillId}"`)
    : baseXf.replace(/<xf\b/, `<xf fillId="${fillId}"`);
  newXf = /\bapplyFill="[^"]*"/.test(newXf)
    ? newXf.replace(/\bapplyFill="[^"]*"/, 'applyFill="1"')
    : newXf.replace(/<xf\b/, '<xf applyFill="1"');
  let styles = stylesXml.replace(/(<cellXfs count=")(\d+)(">)/, (_, a, c, b) => a + (count + 1) + b);
  styles = styles.replace("</cellXfs>", newXf + "</cellXfs>");
  return { styles, newIdx: count };
}

/* ---- Comment / VML anchor shifting (when item rows expand the footer) ---- */

/** Shift comment refs at/below a 1-based row down by `by`. */
function _sliShiftComments(commentsXml, fromRow1, by) {
  if (!commentsXml || by <= 0) return commentsXml;
  return commentsXml.replace(/(<comment ref=")([A-Z]+)(\d+)(")/g, (m, a, col, row, b) => {
    const R = parseInt(row, 10);
    return R >= fromRow1 ? `${a}${col}${R + by}${b}` : m;
  });
}

/** Shift each legacy-comment VML shape whose cell row (0-based) is at/below
    fromRow0 down by `by`, keeping its box anchor in step with the cell. */
function _sliShiftVml(vmlXml, fromRow0, by) {
  if (!vmlXml || by <= 0) return vmlXml;
  return vmlXml.replace(/<v:shape\b[\s\S]*?<\/v:shape>/g, (shape) => {
    const rm = shape.match(/<x:Row>(\d+)<\/x:Row>/);
    if (!rm) return shape;
    const R = parseInt(rm[1], 10);
    if (R < fromRow0) return shape;
    let s = shape.replace(/<x:Row>\d+<\/x:Row>/, `<x:Row>${R + by}</x:Row>`);
    s = s.replace(/<x:Anchor>([^<]+)<\/x:Anchor>/, (m, body) => {
      const p = body.split(",").map((x) => x.trim());
      if (p.length === 8) {
        const tr = parseInt(p[2], 10), br = parseInt(p[6], 10);
        if (Number.isFinite(tr)) p[2] = String(tr + by);
        if (Number.isFinite(br)) p[6] = String(br + by);
        return `<x:Anchor>${p.join(", ")}</x:Anchor>`;
      }
      return m;
    });
    return s;
  });
}

/* ---- Pure workbook-part editor (faithful port of the COM dynamic writer) ---- */

function sliEditWorkbookParts(parts, model) {
  const ITEM_START = 22, ITEM_TEMPLATE_ROWS = 3, FOOTER_START = 25;

  let xml = parts.sheet;
  let stylesXml = parts.styles;
  const st = new PlStringTable(parts.shared);

  const rows = model.lineRows || [];
  const n = Math.max(1, rows.length);
  const extra = Math.max(0, n - ITEM_TEMPLATE_ROWS);
  const hv = model.headerValues || {};

  const editRow = (r, fn) => {
    const rowXml = _plGetRow(xml, r);
    if (!rowXml) return;
    xml = _plReplaceExact(xml, rowXml, fn(rowXml));
  };

  // 1) Header section (original row numbers)
  editRow(3, (rx) => { rx = _sliSetCell(rx, "E3", hv.E3 || "", "inline"); return _sliSetCell(rx, "J3", hv.J3 || "", "inline"); });
  editRow(5, (rx) => _sliSetCell(rx, "E5", hv.E5 || "", "inline"));
  editRow(11, (rx) => { rx = _sliSetCell(rx, "A11", hv.A11 || "", "inline"); return _sliSetCell(rx, "J11", hv.J11 || "", "inline"); });
  editRow(15, (rx) => _sliSetCell(rx, "C15", hv.C15 || "", "inline"));
  editRow(16, (rx) => _sliSetCell(rx, "C16", hv.C16 || "", "inline"));
  editRow(19, (rx) => _sliSetCell(rx, "A19", hv.A19 || "", "inline"));
  editRow(17, (rx) => { rx = _sliSetBool(rx, "C17", model.hazmatYes); return _sliSetBool(rx, "E17", !model.hazmatYes); });
  editRow(26, (rx) => _sliSetBool(rx, "B26", model.remaining2500));
  if (hv.M31 != null && hv.M31 !== "") {
    editRow(31, (rx) => _sliSetCell(rx, "M31", st.idx(hv.M31), "s"));
  }

  // 2) First up-to-3 item rows in place
  for (let i = 0; i < ITEM_TEMPLATE_ROWS; i++) {
    const r = ITEM_START + i;
    const item = i < rows.length ? rows[i] : null;
    editRow(r, (rx) => _sliFillItemRow(rx, r, item, st));
  }

  // 3) Extra item rows: clone row 24, insert before footer (row 25), fill
  let tempBase = 9000;
  for (let i = ITEM_TEMPLATE_ROWS; i < n; i++) {
    const tRow = tempBase++;
    const clone = _plCloneRow(xml, ITEM_START + ITEM_TEMPLATE_ROWS - 1, tRow);
    if (!clone) continue;
    const anchor = _plGetRow(xml, FOOTER_START);
    if (!anchor) continue;
    const at = xml.indexOf(anchor);
    xml = xml.slice(0, at) + clone + xml.slice(at);
    const tRowXml = _plGetRow(xml, tRow);
    if (tRowXml) {
      const item = i < rows.length ? rows[i] : null;
      xml = _plReplaceExact(xml, tRowXml, _sliFillItemRow(tRowXml, tRow, item, st));
    }
  }

  // 4) Renumber all rows sequentially
  xml = _plRenumberRows(xml);

  // 5) Dimension + merge shifting + new item-row merges
  const finalRowCount = (xml.match(/<row /g) || []).length;
  xml = xml.replace(/(<dimension ref="[^:]+:)[A-Z]+\d+(")/, (_, pre, suf) => `${pre}M${finalRowCount}${suf}`);

  if (extra > 0) {
    xml = xml.replace(/<mergeCells[^>]*>[\s\S]*?<\/mergeCells>/, (full) =>
      full.replace(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g, (_, c1, r1, c2, r2) => {
        const n1 = parseInt(r1, 10), n2 = parseInt(r2, 10);
        const s1 = n1 >= FOOTER_START ? n1 + extra : n1;
        const s2 = n2 >= FOOTER_START ? n2 + extra : n2;
        return `<mergeCell ref="${c1}${s1}:${c2}${s2}"/>`;
      })
    );
    // License column stays merged I:K for each new item row (rows 25..24+extra)
    let newMerges = "";
    for (let r = FOOTER_START; r < FOOTER_START + extra; r++) {
      newMerges += `<mergeCell ref="I${r}:K${r}"/>`;
    }
    if (newMerges) {
      xml = xml.replace(/<mergeCells count="(\d+)">/, (_, cnt) => `<mergeCells count="${parseInt(cnt, 10) + extra}">`);
      xml = xml.replace("</mergeCells>", newMerges + "</mergeCells>");
    }
  }

  // 6) Yellow highlights (final addresses, after renumber)
  const yellowCache = {};
  let yellowFillId = null;
  const ensureYellow = (baseIdx) => {
    if (yellowFillId === null) {
      const r = _sliAddYellowFill(stylesXml); stylesXml = r.styles; yellowFillId = r.fillId;
    }
    if (baseIdx in yellowCache) return yellowCache[baseIdx];
    const r = _sliCloneXfYellow(stylesXml, baseIdx, yellowFillId); stylesXml = r.styles;
    yellowCache[baseIdx] = r.newIdx; return r.newIdx;
  };
  const highlightCell = (addr) => {
    const re = new RegExp(`(<c r="${addr}" s=")(\\d+)(")`);
    const m = xml.match(re);
    if (!m) return;
    const yi = ensureYellow(parseInt(m[2], 10));
    xml = xml.replace(re, `$1${yi}$3`);
  };
  for (const addr of (model.highlightCells || [])) highlightCell(addr);
  rows.forEach((row, i) => {
    const r = ITEM_START + i;
    if (row.__highlight_desc) highlightCell(`C${r}`);
    if (row.__highlight_sme) highlightCell(`H${r}`);
  });

  // 7) workbook.xml print area + recalc; drop calcChain references
  let wbXml = parts.workbook;
  wbXml = wbXml.replace(/(_xlnm\.Print_Area[\s\S]*?\$M\$)\d+/, (_, pre) => pre + finalRowCount);
  if (/<calcPr\b[^>]*\/>/.test(wbXml)) {
    wbXml = wbXml.replace(/<calcPr\b([^>]*?)\s*\/>/, (full, attrs) => {
      const a = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "");
      return `<calcPr${a} fullCalcOnLoad="1"/>`;
    });
  } else {
    wbXml = wbXml.replace(/<\/workbook>/, '<calcPr fullCalcOnLoad="1"/></workbook>');
  }
  const ctXml = parts.contentTypes.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, "");
  const relsXml = parts.workbookRels.replace(/<Relationship[^>]*Target="calcChain\.xml"[^>]*\/>/, "");

  // 8) Footer comments + their VML anchors shift down with the inserted rows
  let commentsXml = parts.comments != null ? parts.comments : null;
  let vmlXml = parts.vml != null ? parts.vml : null;
  if (extra > 0) {
    commentsXml = _sliShiftComments(commentsXml, FOOTER_START, extra);
    vmlXml = _sliShiftVml(vmlXml, FOOTER_START - 1, extra); // VML rows are 0-based
  }

  return {
    sheet: xml, shared: st.toXml(), styles: stylesXml, workbook: wbXml,
    contentTypes: ctXml, workbookRels: relsXml, comments: commentsXml, vml: vmlXml,
  };
}

/* ---- Browser: load template, edit, repack to base64 ---- */

async function sliWriteWorkbook(model) {
  const bin = atob(SLI_TEMPLATE_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const zip = await JSZip.loadAsync(bytes);

  const commentsFile = zip.file("xl/comments1.xml");
  const vmlFile = zip.file("xl/drawings/vmlDrawing1.vml");
  const parts = {
    sheet: await zip.file("xl/worksheets/sheet1.xml").async("string"),
    shared: await zip.file("xl/sharedStrings.xml").async("string"),
    styles: await zip.file("xl/styles.xml").async("string"),
    workbook: await zip.file("xl/workbook.xml").async("string"),
    contentTypes: await zip.file("[Content_Types].xml").async("string"),
    workbookRels: await zip.file("xl/_rels/workbook.xml.rels").async("string"),
    comments: commentsFile ? await commentsFile.async("string") : null,
    vml: vmlFile ? await vmlFile.async("string") : null,
  };

  const edited = sliEditWorkbookParts(parts, model);

  const outZip = new JSZip();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (name === "xl/worksheets/sheet1.xml") outZip.file(name, edited.sheet);
    else if (name === "xl/sharedStrings.xml") outZip.file(name, edited.shared);
    else if (name === "xl/styles.xml") outZip.file(name, edited.styles);
    else if (name === "xl/workbook.xml") outZip.file(name, edited.workbook);
    else if (name === "[Content_Types].xml") outZip.file(name, edited.contentTypes);
    else if (name === "xl/_rels/workbook.xml.rels") outZip.file(name, edited.workbookRels);
    else if (name === "xl/comments1.xml" && edited.comments != null) outZip.file(name, edited.comments);
    else if (name === "xl/drawings/vmlDrawing1.vml" && edited.vml != null) outZip.file(name, edited.vml);
    else if (name === "xl/calcChain.xml") continue; // Excel rebuilds on open
    else outZip.file(name, await entry.async("uint8array"));
  }
  return await outZip.generateAsync({ type: "base64" });
}

/* ---- Live preview: HTML mirror of the generated .xlsx (browser only) ---- */

function sliRenderHtml(data, opts) {
  const model = sliBuildModel(data, opts);
  const hv = model.headerValues;
  const hi = new Set(model.highlightCells || []);
  const m = data.meta || {};
  const yel = (addr) => (hi.has(addr) ? ' style="background:#fff7b0;"' : "");

  const itemRows = (model.lineRows || []).map((r) => {
    const cY = r.__highlight_desc ? ' style="background:#fff7b0;"' : "";
    const hY = r.__highlight_sme ? ' style="background:#fff7b0;"' : "";
    const val = r.value
      ? "$" + Number(r.value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "";
    return `<tr>
      <td class="c">${esc(r.df || "")}</td>
      <td class="b"><div class="hts">${esc(r.hts || "")}</div><div class="desc"${cY}>${esc(r.desc || "")}</div></td>
      <td class="c">${esc(r.qty || "")}</td>
      <td class="c">${esc(r.ddtc_qty_uom || "")}</td>
      <td class="c">${esc(r.eccn || "")}</td>
      <td class="c"${hY}>${esc(r.sme || "")}</td>
      <td>${esc(r.license || "")}</td>
      <td class="r">${esc(val)}</td>
    </tr>`;
  }).join("");

  const yesBox = model.hazmatYes ? "☒" : "☐";
  const noBox = model.hazmatYes ? "☐" : "☒";
  const remBox = model.remaining2500 ? "☒" : "☐";

  return `<!doctype html><html><head><meta charset="utf-8"><title>SLI</title>
<style>${SLI_CSS}</style></head><body>
<div class="sli-page">
  <div class="sli-head">
    <div class="sli-co">TRLS II · TechTrans International (TTI)</div>
    <div class="sli-title">SHIPPER'S LETTER OF INSTRUCTION</div>
  </div>

  <div class="grid2">
    <div class="box"><div class="lbl">Freight Location</div><div class="val"${yel("E3")}>${esc(hv.E3 || "")}\n${esc(hv.E5 || "")}</div></div>
    <div class="box"><div class="lbl">Forwarding Agent</div><div class="val"${yel("J3")}>${esc(hv.J3 || "")}</div></div>
  </div>

  <div class="grid2">
    <div class="box"><div class="lbl">Ultimate Consignee</div><div class="val">${esc(hv.A11 || "")}</div></div>
    <div class="box"><div class="lbl">Intermediate Consignee ${hv.J11 ? "" : "(none)"}</div><div class="val">${esc(hv.J11 || "")}</div></div>
  </div>

  <div class="grid3">
    <div class="box"><div class="lbl">State of Origin</div><div class="val"${yel("C15")}>${esc(hv.C15 || "")}</div></div>
    <div class="box"><div class="lbl">Country of Destination</div><div class="val">${esc(hv.C16 || "")}</div></div>
    <div class="box"><div class="lbl">Dangerous Goods</div><div class="val chk">${yesBox} Yes&nbsp;&nbsp;&nbsp;${noBox} No</div></div>
  </div>

  <div class="band">${esc(hv.A19 || "")}</div>

  <table class="sli-tbl">
    <thead><tr>
      <th class="c">D/F</th><th>Schedule B / HTS &amp; Description</th><th class="c">Qty</th>
      <th class="c">DDTC Qty</th><th class="c">ECCN</th><th class="c">SME</th><th>License</th><th class="r">Value (USD)</th>
    </tr></thead>
    <tbody>${itemRows || `<tr><td colspan="8" class="empty">No commodity lines</td></tr>`}</tbody>
  </table>

  <div class="grid2 foot">
    <div class="box"><div class="val chk">${remBox} Remaining non-licensable Schedule B/HTS valued $2,500 or less, not otherwise requiring AES filing</div></div>
    <div class="box"><div class="lbl">Signature Date (Box 42)</div><div class="val">${esc(hv.M31 || "")}</div></div>
  </div>
</div>
</body></html>`;
}

const SLI_CSS = `
html,body{ margin:0; padding:0; }
body{ font-family: Arial, Helvetica, sans-serif; font-size:10pt; color:#000; }
.sli-page{ box-sizing:border-box; width:760px; margin:0 auto; background:#fff; box-shadow:0 0 10px rgba(0,0,0,0.25); padding:20px 22px 24px; }
.sli-head{ display:flex; align-items:center; justify-content:space-between; border:1px solid #000; }
.sli-co{ font-weight:bold; font-size:8.5pt; padding:7px 10px; border-right:1px solid #000; flex:1; }
.sli-title{ font-size:13pt; font-weight:bold; letter-spacing:0.5px; padding:7px 12px; flex:2; text-align:center; }
.grid2{ display:grid; grid-template-columns:1fr 1fr; border:1px solid #000; border-top:0; }
.grid3{ display:grid; grid-template-columns:1fr 1fr 1fr; border:1px solid #000; border-top:0; }
.box{ display:flex; flex-direction:column; }
.grid2 .box + .box, .grid3 .box + .box{ border-left:1px solid #000; }
.box .lbl{ background:#e9edf1; font-weight:bold; font-size:7.5pt; padding:3px 6px; border-bottom:1px solid #000; }
.box .val{ padding:6px; font-size:8pt; line-height:1.3; min-height:34px; white-space:pre-line; }
.box .val.chk{ font-size:9pt; min-height:0; }
.foot{ border-top:0; }
.band{ border:1px solid #000; border-top:0; padding:6px 8px; font-size:8pt; font-weight:bold; background:#fcfcdc; }
.sli-tbl{ width:100%; border-collapse:collapse; table-layout:fixed; margin-top:10px; }
.sli-tbl th{ background:#e9edf1; border:1px solid #000; padding:4px 5px; font-size:7.5pt; text-align:left; }
.sli-tbl td{ border:1px solid #000; padding:3px 5px; font-size:7.5pt; vertical-align:top; word-wrap:break-word; overflow-wrap:break-word; }
.sli-tbl .c{ text-align:center; } .sli-tbl .r{ text-align:right; }
.sli-tbl .empty{ text-align:center; color:#888; font-style:italic; }
.sli-tbl .hts{ font-weight:bold; } .sli-tbl .desc{ color:#222; }
.sli-tbl th:nth-child(1),.sli-tbl td:nth-child(1){ width:5%; }
.sli-tbl th:nth-child(3),.sli-tbl td:nth-child(3){ width:8%; }
.sli-tbl th:nth-child(4),.sli-tbl td:nth-child(4){ width:9%; }
.sli-tbl th:nth-child(5),.sli-tbl td:nth-child(5){ width:9%; }
.sli-tbl th:nth-child(6),.sli-tbl td:nth-child(6){ width:5%; }
.sli-tbl th:nth-child(7),.sli-tbl td:nth-child(7){ width:12%; }
.sli-tbl th:nth-child(8),.sli-tbl td:nth-child(8){ width:12%; }
`;

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    sliBuildModel, sliEditWorkbookParts,
    _sliClassifyCtrl, _sliNum, _sliFmtQty, _sliPartyBlockWithPoc, _sliExtractState,
  };
  const u = require("../util.js");
  for (const k of Object.keys(u)) global[k] = u[k];
  const c = require("../constants.js");
  for (const k of Object.keys(c)) global[k] = c[k];
  const q = require("../udq.js");
  global.makeParty = q.makeParty;
  global.makeLineItem = q.makeLineItem;
}
