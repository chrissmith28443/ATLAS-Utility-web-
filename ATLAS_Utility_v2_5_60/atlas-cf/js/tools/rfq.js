/* =========================================================================
   ATLAS Utility Web — tools/rfq.js
   Faithful port of services/rfq_service.py (the RFQ email pipeline).

   Differences from desktop, by design:
     - The desktop re-opens the .xlsx and re-parses it with a second header
       map. Here we reuse the already-parsed SRF model (AppState.data) that
       udq.js built when the file was dropped — same UDQ, one parse.
     - "Copy to clipboard + open Outlook compose" becomes "Copy email (HTML)"
       to the system clipboard plus an "Open draft email" mailto link, since
       the browser can't drive a desktop Outlook profile.

   Package rows (Serial # == "P") become the RFQ commodity rows, exactly as
   the desktop _rfq_read_inventory_items did (it kept only serial == "P").
   ========================================================================= */

/* -------------------------------------------------------------------------
   Formatting helpers (ports of the _fmt_* functions in rfq_service.py)
   ------------------------------------------------------------------------- */

/** "$1,234.56" or "N/A" (port of _fmt_usd_or_na). Blank input -> "N/A". */
function rfqUsdOrNa(raw) {
  const s = (raw == null ? "" : String(raw)).trim();
  if (!s) return "N/A";
  const cleaned = s.replace(/\$/g, "").replace(/,/g, "").trim();
  const val = Number(cleaned);
  if (!isFinite(val) || cleaned === "") return "N/A";
  return "$" + val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Number formatter that trims trailing zeros (port of _fmt_num).
 *   12   -> "12"      12.00 -> "12"      12.50 -> "12.5"
 * Non-numeric text is returned as-is; blank stays blank.
 */
function rfqNum(val, decimals = 2) {
  if (val === null || val === undefined) return "";
  if (typeof val === "number" && Number.isInteger(val)) return String(val);
  let s = String(val).trim();
  if (!s) return "";
  s = s.replace(/,/g, "");
  const cleaned = s.replace(/[^0-9.\-]/g, "");
  if (!cleaned || [".", "-", "-.", ".-"].includes(cleaned)) return "";
  const n = Number(cleaned);
  if (!isFinite(n)) return s;
  let out = n.toFixed(decimals);
  if (out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
  return out || "0";
}

/** "1,234 lb (560 kg)" or "N/A" (port of _fmt_lbs_and_kg_or_na). */
function rfqLbsAndKgOrNa(raw) {
  const s = (raw == null ? "" : String(raw)).trim();
  if (!s) return "N/A";
  const cleaned = s.replace(/[^0-9.\-]/g, "");
  if (!cleaned || [".", "-", "-.", ".-"].includes(cleaned)) return "N/A";
  const lbs = Number(cleaned);
  if (!isFinite(lbs) || lbs <= 0) return "N/A";
  const kg = lbs * 0.45359237;
  return `${rfqNum(lbs)} lb (${rfqNum(kg)} kg)`;
}

/**
 * Parse UDQ dims and ALWAYS return inches (port of _rfq_parse_dims_in).
 * Unit comes from a "(unit)" suffix; missing/unknown unit is treated as
 * inches (desktop legacy behavior). Note: the shared util.parseDimsIn is
 * intentionally unit-agnostic, so RFQ keeps its own unit-aware version to
 * honor the "Ln/Wd/Ht (in)" column headers.
 */
function rfqDimsToInches(dimsText) {
  const s = (dimsText == null ? "" : String(dimsText)).replace(/\xa0/g, " ").trim();
  if (!s) return ["", "", ""];

  let unit = null;
  const mUnit = s.match(/\(([^)]+)\)/);
  if (mUnit) unit = (mUnit[1] || "").trim().toLowerCase();
  const unitMap = {
    in: "in", inch: "in", inches: "in",
    cm: "cm", centimeter: "cm", centimeters: "cm",
    mm: "mm", millimeter: "mm", millimeters: "mm",
    ft: "ft", foot: "ft", feet: "ft",
  };
  unit = unitMap[unit] || unit;

  const nums = s.match(/[0-9]+(?:\.[0-9]+)?/g) || [];
  if (nums.length < 3) return ["", "", ""];
  let L = parseFloat(nums[0]), W = parseFloat(nums[1]), H = parseFloat(nums[2]);
  if (![L, W, H].every(isFinite)) return ["", "", ""];

  let factor;
  if (unit === null || unit === "" || unit === "in") factor = 1.0;
  else if (unit === "cm") factor = 1.0 / 2.54;
  else if (unit === "mm") factor = 1.0 / 25.4;
  else if (unit === "ft") factor = 12.0;
  else factor = 1.0; // unknown -> legacy inches

  return [L * factor, W * factor, H * factor];
}

/**
 * Strip internal notes in parentheses from a package/parent description
 * (port of _rfq_strip_parent_parens). "Pallet (Parent item - not on CI)"
 * -> "Pallet". Only applied to Serial # == "P" rows, which is all of
 * AppState.data.packages.
 */
function rfqStripParens(desc) {
  let s = (desc == null ? "" : String(desc)).replace(/\xa0/g, " ").trim().replace(/\s+/g, " ");
  if (!s) return "";
  s = s.replace(/\s*\([^)]*\)/g, "").trim();
  s = s.replace(/\s{2,}/g, " ");
  return s;
}

/* -------------------------------------------------------------------------
   HTML block builders (ports of _rfq_lines_to_divs / _rfq_render_item_rows)
   ------------------------------------------------------------------------- */

/** A party's address lines -> stacked <div>s (port of _rfq_lines_to_divs). */
function rfqLinesToDivs(lines, country) {
  const all = [];
  for (const ln of lines || []) {
    const v = (ln == null ? "" : String(ln)).replace(/\xa0/g, " ").trim();
    if (v) all.push(v);
  }
  // The desktop composed address lines already include the country line;
  // udq.js keeps country separate, so append it when it isn't already shown.
  const c = (country || "").trim();
  if (c && !all.some((x) => x.toLowerCase() === c.toLowerCase())) all.push(c);

  if (!all.length) return "<div></div>";
  return all.map((ln) => `<div>${esc(ln)}</div>`).join("");
}

/** Render the commodity rows that replace <!--ITEM_ROWS--> (port of _rfq_render_item_rows). */
function rfqRenderItemRows(items) {
  const cstyle =
    "border-top:none;border-left:none;border-bottom:solid black 1.0pt;border-right:solid black 1.0pt;" +
    "padding:0;mso-padding-alt:0;text-align:center;vertical-align:middle;" +
    "height:.25in;mso-line-height-rule:exactly;";
  const dstyle =
    "border:solid black 1.0pt;border-top:none;padding:.75pt 5.4pt .75pt 5.4pt;" +
    "text-align:left;vertical-align:middle;height:.25in;mso-line-height-rule:exactly;";

  return (items || []).map((it) => {
    const desc = esc(it.desc || "");
    const qty = esc(rfqNum(it.qty));
    const uom = esc(it.uom || "");
    const L = esc(rfqNum(it.L));
    const W = esc(rfqNum(it.W));
    const H = esc(rfqNum(it.H));
    const wt = esc(rfqNum(it.wt_lbs));
    return (
`<tr style="height:.25in;mso-line-height-rule:exactly;">
    <td width=456 colspan=11 valign="middle" style="width:4.75in;${dstyle}">
    ${desc}
    </td>

    <td width=60 colspan=4 valign="middle" style="width:45.0pt;${cstyle}">
    ${qty}
    </td>

    <td width=60 colspan=3 valign="middle" style="width:45.0pt;${cstyle}">
    ${uom}
    </td>

    <td width=66 colspan=2 valign="middle" style="width:49.5pt;${cstyle}">
    ${L}
    </td>

    <td width=65 colspan=3 valign="middle" style="width:49.1pt;${cstyle}">
    ${W}
    </td>

    <td width=61 colspan=3 valign="middle" style="width:45.4pt;${cstyle}">
    ${H}
    </td>

    <td width=102 colspan=3 valign="middle" style="width:76.5pt;${cstyle}">
    ${wt}
    </td>
</tr>`
    );
  }).join("\n");
}

/* -------------------------------------------------------------------------
   Model + fill (ports of _rfq_parse_udq_for_rfq + merge + _rfq_fill_placeholders)
   ------------------------------------------------------------------------- */

/**
 * Build the RFQ model from the parsed SRF data + the workspace form options.
 * `data` is AppState.data (from readUdq); `opts` mirrors the desktop RFQDialog.
 */
function rfqBuildModel(data, opts) {
  const m = data.meta;
  const p = data.parties;

  // Commodity rows = the package rows (Serial # == "P"), parentheses stripped.
  const items = (data.packages || []).map((pk) => {
    const [L, W, H] = rfqDimsToInches(pk.dims);
    return {
      desc: rfqStripParens(pk.description),
      qty: pk.count,           // truncated package count (matches desktop Quantity)
      uom: pk.uoi || "",
      L, W, H,
      wt_lbs: pk.weight_lbs || "",
    };
  });

  // RFQ number: RFQ-<last5 of WMTR>-001
  const last5 = m.wmtr_last5 || wmtrLast5(m.wmtr);
  const rfqNumber = last5 ? `RFQ-${last5}-001` : "";

  const pickupCountry = norm(p.pickup.country);
  const deliveryCountry = norm(p.deliver.country);

  // EAR/ITAR summary
  let earItar;
  if (opts.ear && opts.itar) earItar = "Yes, both EAR & ITAR included";
  else if (opts.ear) earItar = "Yes, EAR included";
  else if (opts.itar) earItar = "Yes, ITAR included";
  else earItar = "No";
  const earItarComment = (opts.earitarComment || "").trim();
  if (earItarComment) earItar += ` — ${earItarComment}`;

  // Dangerous goods / temperature control summaries
  const dg = (opts.dg || "No").trim();
  const dgComment = (opts.dgComment || "").trim();
  const dangerousGoods = dg + (dgComment ? ` — ${dgComment}` : "");

  const tc = (opts.tc || "No").trim();
  const tcComment = (opts.tcComment || "").trim();
  const tempControl = tc + (tcComment ? ` — ${tcComment}` : "");

  // Total weight: prefer ATLAS shipment total (raw lbs), formatted lb (kg).
  const rawLbs = (m.totals_raw && m.totals_raw.udq_lbs) ? m.totals_raw.udq_lbs : "";
  const totalWeight = rfqLbsAndKgOrNa(rawLbs);

  return {
    rfq_number: rfqNumber,
    wmtr_number: m.wmtr || "",
    response_date: (opts.respDate || "").trim(),
    rfq_description: (m.request_title || "").trim(),

    pickup_block_html: rfqLinesToDivs(p.pickup.addr_lines, p.pickup.country),
    delivery_block_html: rfqLinesToDivs(p.deliver.addr_lines, p.deliver.country),

    total_pkgs: items.length ? String(items.length) : "0",
    total_weight_lbs: totalWeight,

    insured_value: rfqUsdOrNa(opts.insured),
    ear_itar: earItar,
    dangerous_goods: dangerousGoods,
    temp_control: tempControl,
    mode_of_transit: (opts.mode || "").trim(),

    item_rows_html: rfqRenderItemRows(items),

    pickup_country: pickupCountry,
    delivery_country: deliveryCountry,

    _items: items, // kept for the summary line
  };
}

/* -------------------------------------------------------------------------
   Export-control classification from the inventory ECCN/USML column.
   Each inventory line's classification (it.eccn — the "ECCN/USML" field) tells
   us whether the shipment carries EAR- and/or ITAR-controlled items:
     • EAR  — an ECCN (e.g. 3A001, 1A004.a, 5A991) or the EAR99 catch-all.
     • ITAR — a USML category citation (e.g. "USML XI(a)", "Cat XI", "XI(a)").
   Used to pre-fill the RFQ's EAR / ITAR checkboxes; the user can still override.
   ------------------------------------------------------------------------- */
function rfqClassifyExportControl(items) {
  // ECCN: category digit 0-9, product group A-E, 3 digits, optional .subparagraph.
  const eccnRe = /^[0-9][A-E][0-9]{3}(?:\.[A-Z0-9.]+)?$/i;
  // USML: a Roman-numeral category (I–XXI), optionally prefixed "USML"/"Cat[egory]"
  // and/or suffixed with a "(a)"-style subparagraph.
  const usmlRe = /^(?:USML\s*)?(?:CAT(?:EGORY)?\.?\s*)?[IVX]{1,5}(?:\s*\([A-Z0-9.]+\))?$/i;
  let ear = false, itar = false;
  for (const it of (items || [])) {
    const v = norm(it && it.eccn).toUpperCase();
    if (!v) continue;
    if (v === "EAR99" || eccnRe.test(v)) { ear = true; continue; }
    if (/\bITAR\b/.test(v) || /\bUSML\b/.test(v) || usmlRe.test(v)) { itar = true; continue; }
    // Unrecognized token: leave it for manual review rather than guessing.
  }
  return { ear, itar };
}

/** Subject line: "RFQ-#####-001 / USA to Jordan" (port of the subject logic). */
function rfqSubject(model) {
  const rfqNo = (model.rfq_number || "").trim();
  const pc = (model.pickup_country || "").trim();
  const dc = (model.delivery_country || "").trim();
  let route = "";
  if (pc && dc) route = `${pc} to ${dc}`;
  else if (pc || dc) route = pc || dc;
  let subject = rfqNo || "RFQ";
  if (route) subject = `${subject} / ${route}`;
  return subject;
}

/** Fill placeholders + inject item rows (port of _rfq_fill_placeholders). */
function rfqFillPlaceholders(tpl, model) {
  let out = tpl;
  const repl = {
    "{RFQ_NUMBER}": model.rfq_number,
    "{WMTR_NUMBER}": model.wmtr_number,
    "{RESPONSE_DATE}": model.response_date,
    "{RFQ_DESCRIPTION}": model.rfq_description,

    "{PICKUP_BLOCK}": model.pickup_block_html,
    "{PICKUP_LOCATION_BLOCK}": model.pickup_block_html,
    "{DELIVERY_BLOCK}": model.delivery_block_html,
    "{DELIVERY_DESTINATION_BLOCK}": model.delivery_block_html,

    "{TOTAL_PKG_COUNT}": model.total_pkgs,
    "{TOTAL_PACKAGE_COUNT}": model.total_pkgs,
    "{TOTAL_WEIGHT_LBS}": model.total_weight_lbs,
    "{ESTIMATED_TOTAL_CARGO_WEIGHT}": model.total_weight_lbs,
    "{FINAL_TOTAL_CGO_WEIGHT}": model.total_weight_lbs,

    "{INSURED_VALUE_USD}": model.insured_value,
    "{INSURED_VALUE}": model.insured_value,
    "{INCLUDES_EAR_ITAR}": model.ear_itar,
    "{EAR_ITAR}": model.ear_itar,
    "{DANGEROUS_GOODS}": model.dangerous_goods,
    "{INCLUDES_DANGEROUS_GOODS}": model.dangerous_goods,
    "{TEMPERATURE_CONTROL}": model.temp_control,
    "{TEMP_CONTROL}": model.temp_control,
    "{REQUESTED_MODE_OF_TRANSIT}": model.mode_of_transit,
    "{REQUESTED_MODE}": model.mode_of_transit,
    "{MODE_OF_TRANSIT}": model.mode_of_transit,
  };

  for (const [k, v] of Object.entries(repl)) {
    if (out.includes(k)) out = out.split(k).join(String(v || ""));
  }

  // Mode tokens are re-applied unconditionally, matching the desktop.
  const modeVal = String(model.mode_of_transit || "");
  for (const token of ["{REQUESTED_MODE}", "{REQUESTED_MODE_OF_TRANSIT}", "{MODE_OF_TRANSIT}"]) {
    out = out.split(token).join(modeVal);
  }

  if (out.includes("<!--ITEM_ROWS-->")) {
    out = out.split("<!--ITEM_ROWS-->").join(model.item_rows_html || "");
  }
  return out;
}

/** Full filled HTML email body for the given data + form options. */
function rfqRenderHtml(data, opts) {
  return rfqFillPlaceholders(rfqTemplateHtml(), rfqBuildModel(data, opts));
}

/** Plain-text fallback (port of _html_to_plain). */
function rfqHtmlToPlain(htmlBody) {
  let plain = htmlBody.replace(/<br\s*\/?>/gi, "\n");
  plain = plain.replace(/<\/p\s*>/gi, "\n\n");
  plain = plain.replace(/<[^>]+>/g, "");
  const ta = document.createElement("textarea");
  ta.innerHTML = plain;
  return ta.value.trim();
}

/* -------------------------------------------------------------------------
   .eml draft builder
   Produces a self-contained RFC 5322 / MIME message whose HTML body is the
   filled RFQ. Double-clicking the saved .eml opens it in Outlook as an
   editable, sendable draft — no manual paste. The "X-Unsent: 1" header is
   what makes Outlook treat it as a compose draft rather than a received
   message. The RFQ template carries no images or external links, so a single
   text/html part is enough (no multipart/related needed).
   ------------------------------------------------------------------------- */

/** UTF-8-safe base64 (browser btoa is Latin-1 only). */
function rfqB64Utf8(str) {
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(str)));
  }
  // Node fallback (tests)
  return Buffer.from(str, "utf-8").toString("base64");
}

/** Wrap a long base64 blob to 76-char lines (RFC 2045). */
function rfqWrap76(s) {
  return (s.match(/.{1,76}/g) || []).join("\r\n");
}

/** RFC 2047-encode a header value only if it contains non-ASCII characters. */
function rfqEncodeHeader(value) {
  const v = String(value || "");
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(v)) return v;
  return "=?utf-8?B?" + rfqB64Utf8(v) + "?=";
}

/** RFC 5322 date, e.g. "Wed, 11 Jun 2026 03:45:00 +0000". */
function rfqRfc5322Date(d) {
  return (d || new Date()).toUTCString().replace(/GMT$/, "+0000");
}

/**
 * Build a complete .eml draft string.
 *   subject : the RFQ subject line
 *   html    : the filled RFQ HTML body
 *   opts.to : optional recipient string (comma-separated), left blank if absent
 */
function rfqBuildEml(subject, html, opts) {
  const o = opts || {};
  const headers = [];
  headers.push("X-Unsent: 1"); // Outlook: open as an editable draft
  if ((o.to || "").trim()) headers.push("To: " + rfqEncodeHeader(o.to.trim()));
  headers.push("Subject: " + rfqEncodeHeader(subject));
  headers.push("Date: " + rfqRfc5322Date());
  headers.push("MIME-Version: 1.0");
  headers.push("Content-Type: text/html; charset=utf-8");
  headers.push("Content-Transfer-Encoding: base64");

  const body = rfqWrap76(rfqB64Utf8(html));
  return headers.join("\r\n") + "\r\n\r\n" + body + "\r\n";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    rfqUsdOrNa, rfqNum, rfqLbsAndKgOrNa, rfqDimsToInches, rfqStripParens,
    rfqLinesToDivs, rfqRenderItemRows, rfqBuildModel, rfqSubject,
    rfqClassifyExportControl,
    rfqFillPlaceholders, rfqRenderHtml, rfqHtmlToPlain,
    rfqB64Utf8, rfqBuildEml,
  };
}
