/* =========================================================================
   ATLAS Utility Web — tools/po.js
   Purchase Order document, ported from desktop:
     services/po_document.py  (POData, build_po_context, generate_po_pdf)
     ui/po_dialog.py          (vendor map + abbreviations + validation)
     templates/po_document.html, templates/po.css

   The PO is a single-page, portrait-Letter print document (like the CI):
   the model is built from the form, rendered to HTML with the CSS embedded
   verbatim, previewed in an iframe, and saved through the browser's
   "Save as PDF" print path. No UDQ is strictly required — the WMTR is
   editable and is prefilled from a loaded SRF when one is present, matching
   the desktop dialog (default_wmtr).
   ========================================================================= */

/* Vendor address book (identical to the desktop PODialog.vendor_map and to
   SLI_LOCATIONS in constants.js). Kept here in the desktop dialog's display
   order so the dropdown matches the desktop tool. */
const PO_VENDORS = [
  "Sovana Global Logistics",
  "Epona Logistics",
  "Lynden Logistics",
  "APL/CEVA Government Logistics",
  "ICAT Logistics, Inc.",
  "MEBS Global Reach, LLC",
  "ARC",
  "ALARA Logistics, LLC",
  "Aegis Trade Solutions",
  "AMI Expeditionary Healthcare",
  "All Points, LLC",
  "Connexi",
];

/* Vendor -> abbreviation used to build the PO number
   (port of vendor_abbrev_map in build_po_context). */
const PO_ABBREV = {
  "Sovana Global Logistics": "SGL",
  "Epona Logistics": "Epona",
  "APL/CEVA Government Logistics": "ACGL",
  "ICAT Logistics, Inc.": "ICAT",
  "MEBS Global Reach, LLC": "MEBS",
  "ALARA Logistics, LLC": "ALARA",
  "Aegis Trade Solutions": "Aegis",
  "All Points, LLC": "All Points",
  "Lynden Logistics": "Lynden",
  "ARC": "ARC",
  "AMI Expeditionary Healthcare": "AMI",
  "Connexi": "Connexi",
};

/* Fixed contract subject line — verbatim from po_document.html. Note the
   desktop template hardcodes "HDTRA12D0002" here (distinct from the CI's
   DEFAULT_CONTRACT_NO); preserved exactly to keep document parity. */
const PO_SUBJECT = "CONTRACT NO. HDTRA12D0002 IDIQ - TASK ORDER AWARD";

/* Fixed best-value justification paragraph — verbatim from po_document.html. */
const PO_JUSTIFICATION =
  "The selection of this TRLS II preferred vendor, for this Purchase Order is based on a best value determination. " +
  "The above mentioned vendor was chosen due to their demonstrated ability to provide high-quality " +
  "Shipping/Receiving/Freight Forwarding services. Their international experience meets or exceeds the required " +
  "specifications, ensuring reliability and performance critical to our operational needs. Their competitive pricing " +
  "aligns with budgetary constraints, offering cost-effectiveness without compromising quality. Additionally, their " +
  "proven track record of timely delivery, compliance with TRLS II standards, and exceptional customer support further " +
  "supports their selection. This combination of quality, cost, and reliability ensures the best value for this procurement, " +
  "maximizing efficiency and mission success.";

/* Fixed FAR Part 47.403 note (red) — verbatim from po_document.html. */
const PO_FAR_NOTE =
  "Note: All TRLS II purchase orders involving international air transportation must comply with FAR Part 47.403. " +
  "Contractors are required to use U.S.-flag air carriers for all international air transportation of persons (and their " +
  "personal effects) or property, unless such carriers are unavailable or impractical. In cases where a foreign-flag air " +
  "carrier is used, contractors must include the following statement on vouchers, as required by FAR 47.403(d): " +
  "STATEMENT OF UNAVAILABILITY OF U.S.-FLAG AIR CARRIERS " +
  "International air transportation of persons (and their personal effects) or property by U.S.-flag air carrier was not " +
  "available or it was necessary to use foreign-flag air carrier service for the following reasons (see section 47.403 of " +
  "the Federal Acquisition Regulation): [State specific reasons, e.g., no U.S.-flag carrier service available on required " +
  "route or schedule, or cost/schedule necessity]. (End of statement) " +
  "Contractors must include the substance of this clause, including the requirement to incorporate it in all subcontracts " +
  "or purchase orders under this contract that may involve international air transportation, per FAR 47.403(e).";

const PO_FOOTER = "2200 Space Park Dr. Suite 410 \u2022 Houston, TX 77058";

/** One-line vendor address from the shared SLI address book. */
function poVendorAddress(vendor) {
  const addr = (typeof SLI_LOCATIONS !== "undefined" && SLI_LOCATIONS[vendor]) || "";
  return addr.split("\n").map((s) => s.trim()).filter(Boolean).join(" ");
}

/** Last 5 digits of all digits in the WMTR (port of build_po_context). */
function poWmtrLast5(wmtr) {
  const digits = String(wmtr || "").replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(-5) : "";
}

/** "USD $1,234.50" (port of _fmt_usd). */
function poFmtUsd(val) {
  const raw = String(val || "").trim();
  const cleaned = raw.replace(/USD/gi, "").replace(/\$/g, "").replace(/,/g, "").trim();
  const amt = parseFloat(cleaned);
  if (Number.isFinite(amt)) {
    return "USD $" + amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return "USD " + raw;
}

/** {year}-{vendorAbbrev}-{wmtrLast5} (port of build_po_context). */
function poNumber(wmtr, vendor, overrideNo) {
  if (overrideNo && overrideNo.trim()) return overrideNo.trim();
  const year = new Date().getFullYear();
  const last5 = poWmtrLast5(wmtr);
  let abbrev = PO_ABBREV[(vendor || "").trim()];
  if (!abbrev) abbrev = String(vendor || "").replace(/[^A-Za-z0-9]+/g, "").slice(0, 10);
  return `${year}-${abbrev}-${last5}`;
}

/** Build the PO render context from the form options (port of build_po_context). */
function poBuildModel(opts) {
  const o = opts || {};
  const wmtr = (o.wmtr || "").trim();
  const vendor = (o.vendor || "").trim();
  const number = poNumber(wmtr, vendor, o.poNumber);
  const last5 = poWmtrLast5(wmtr);
  return {
    date: (o.poDate || todayISO()).trim(),
    po_number: number,
    wmtr_text: wmtr || `WMTR #${last5}`,
    vendor,
    vendor_address: poVendorAddress(vendor),
    cost_amount: poFmtUsd(o.cost),
    notes: (o.notes || "").trim(),
    logo_uri: LOGO_LEFT, // TTI logo (140x140)
    safe_po: number.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, ""),
  };
}

/** Full printable HTML document for the PO (port of po_document.html). */
function poRenderHtml(model, docTitle) {
  const notesBlock = model.notes
    ? `<div class="para"><b>Comments:</b> ${escBr(model.notes)}</div>`
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(docTitle || "Purchase Order")}</title>
<style>
${PO_CSS}
</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="logo"><img src="${model.logo_uri}" alt="TTI Logo"></div>
      <div class="header-text">
        <div><b>Date:</b> ${esc(model.date)}</div>
        <div><b>Purchase Order:</b> ${esc(model.po_number)}</div>
      </div>
    </div>

    <div class="subject-line"><b>Subject:</b> ${esc(PO_SUBJECT)}</div>

    <div class="section">
      <div class="section-title">1. Description of Product or Service</div>
      <div class="desc-block">
        <div class="para">This PO is for shipping and delivery of ${esc(model.wmtr_text)}.</div>
        <div class="para">SRF Awarded Price: ${esc(model.cost_amount)}</div>
        ${notesBlock}
      </div>
    </div>

    <div class="section">
      <div class="section-title">2. Vendor Information</div>
      <div class="vendor-block">
        <div class="para"><b>Vendor Name:</b> ${esc(model.vendor)}</div>
        <div class="para"><b>Address:</b> ${esc(model.vendor_address)}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">3. Justification: The following circumstances justify this Purchase Order:</div>
      <div class="para">${esc(PO_JUSTIFICATION)}</div>
    </div>

    <div class="signature">
      _____________________<br/>
      TTI TRLS II Signature
    </div>

    <div class="notes">${esc(PO_FAR_NOTE)}</div>
  </div>

  <div class="footer">${esc(PO_FOOTER)}</div>
</body>
</html>`;
}

/* ---- po.css, embedded from desktop templates/po.css ----
   Print rules are kept verbatim; an @media screen block adds the
   paper-preview look (centered page, shadow, static footer) for the iframe. */
const PO_CSS = `
@page { size: letter; margin: 0.75in; }

html, body { margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #000; line-height: 1.2; background: #fff; }

* { box-sizing: border-box; }

.page { width: 100%; page-break-inside: avoid; }

.section{ margin-top: 10px; }
.section-title{ font-weight: bold; margin-bottom: 6px; }
.para{ margin: 6px 0; }

.header{
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
}
.logo img{ height: 120px; width: auto; }
.header-text{ text-align: right; font-size: 11pt; margin-top: 28px; }

.subject-line{ margin: 10px 0 14px; white-space: nowrap; font-weight: 500; }

.desc-block{ margin-left: 32px; }
.desc-block .para { line-height: 1.25; margin: 6px 0; }

.vendor-block{ margin-left: 32px; }

.signature{ margin-top: 48px; }

.notes{
  margin-top: 16px;
  font-size: 9pt;
  line-height: 1.2;
  color: #b00000;
}

.footer{
  position: fixed;
  bottom: 0.35in;
  left: 0.35in;
  right: 0.35in;
  text-align: center;
  font-size: 11pt;
  font-weight: 500;
  color: #1f4e79;
  line-height: 1.2;
  border-top: 1px solid #ccc;
  padding-top: 4px;
}

/* Preview-only paper look (does not affect the printed PDF) */
@media screen {
  body { background: transparent; }
  .page {
    width: 7in;                 /* Letter portrait minus 0.75in margins */
    min-height: 9.3in;
    margin: 0 auto;
    padding: 0.5in 0.5in 0.75in;
    background: #fff;
    box-shadow: 0 0 10px rgba(0,0,0,0.25);
    position: relative;
  }
  .footer{
    position: static;
    left: auto; right: auto; bottom: auto;
    width: 6in;
    margin: 0.5in auto 0;
  }
}
`;

/* Node test support (ignored by the browser) */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PO_VENDORS, PO_ABBREV, PO_SUBJECT,
    poVendorAddress, poWmtrLast5, poFmtUsd, poNumber, poBuildModel, poRenderHtml,
  };
}
