/* =========================================================================
   ATLAS Utility Web — tools/propo.js
   PROPERTY-MANAGEMENT Purchase Order.

   This is a sibling of the Shipping-documents PO (tools/po.js). It looks and
   behaves the same — single-page portrait-Letter print document, built from a
   form, previewed in an iframe, saved via the browser's "Save as PDF" path —
   with these intentional differences requested for property management:

     1. Vendor name AND vendor address are free-text / manual entry (because most
        property-PO vendors are new and not in any address book). A "pick from
        list" control is provided for the cases where the vendor IS on a list:
        built-in vendors (the shared address book) plus any vendors the team has
        added under Settings ▸ Purchase Order vendors.
     2. Para 1 reads "This PO is for WMTR #…" (not "shipping and delivery of").
     3. The awarded-price line reads "Awarded Price:" (not "SRF Awarded Price:").
     4. The justification paragraph is the procurement-services wording (below),
        not the shipping/freight-forwarding wording used by the shipping PO.

   Everything else (PO number format, USD formatting, fixed subject line, the
   FAR 47.403 note, the footer, and all CSS) is reused verbatim from po.js so the
   two documents stay visually identical. The shipping PO is left untouched.
   ========================================================================= */

/* Procurement-services justification (replaces PO_JUSTIFICATION for this doc). */
const PROPO_JUSTIFICATION =
  "The selection of this TRLS II preferred vendor for this Purchase Order is based on a best value determination. " +
  "The above mentioned vendor was chosen due to their demonstrated ability to provide high-quality procurement " +
  "services. Their international experience meets or exceeds the required specifications, ensuring reliability and " +
  "performance critical to our operational needs. Their competitive pricing aligns with budgetary constraints, " +
  "offering cost-effectiveness without compromising quality. This combination of quality and cost ensures the best " +
  "value for this procurement, maximizing efficiency and mission success.";

/** Combined vendor list for the property-PO picker:
 *  built-in vendors (name + shared-address-book address + known abbreviation)
 *  followed by the team's custom Settings vendors. Custom entries with a name
 *  matching a built-in are kept separate (the picker shows both labels), but the
 *  abbreviation/address resolvers below prefer the custom entry when present.
 *  Returns [{ name, address, abbrev, custom }]. */
function propoVendorList() {
  const out = [];
  const builtins = (typeof PO_VENDORS !== "undefined") ? PO_VENDORS : [];
  for (const name of builtins) {
    out.push({
      name,
      address: (typeof poVendorAddress === "function") ? poVendorAddress(name) : "",
      abbrev: (typeof PO_ABBREV !== "undefined" && PO_ABBREV[name]) || "",
      custom: false,
    });
  }
  let customs = [];
  try {
    if (typeof AtlasSettings !== "undefined") customs = AtlasSettings.get().customVendors || [];
  } catch (e) { customs = []; }
  for (const c of customs) {
    const name = String((c && c.name) || "").trim();
    if (!name) continue;
    out.push({
      name,
      address: String((c && c.address) || "").trim(),
      abbrev: String((c && c.abbrev) || "").trim(),
      custom: true,
    });
  }
  return out;
}

/** Resolve a custom-vendor abbreviation by name (case-insensitive), if any. */
function propoCustomAbbrev(vendor) {
  const want = String(vendor || "").trim().toLowerCase();
  if (!want) return "";
  for (const v of propoVendorList()) {
    if (v.custom && v.name.toLowerCase() === want && v.abbrev) return v.abbrev;
  }
  return "";
}

/** {year}-{abbrev}-{wmtrLast5}. Like poNumber, but also honours a custom
 *  vendor's abbreviation (set in Settings) before falling back to a slug. */
function propoNumber(wmtr, vendor, overrideNo) {
  if (overrideNo && overrideNo.trim()) return overrideNo.trim();
  const year = new Date().getFullYear();
  const last5 = poWmtrLast5(wmtr);
  const v = String(vendor || "").trim();
  let abbrev = (typeof PO_ABBREV !== "undefined" && PO_ABBREV[v]) || "";
  if (!abbrev) abbrev = propoCustomAbbrev(v);
  if (!abbrev) abbrev = v.replace(/[^A-Za-z0-9]+/g, "").slice(0, 10);
  return `${year}-${abbrev}-${last5}`;
}

/** Build the render context from the form (port of poBuildModel, but vendor and
 *  vendor_address come straight from the manual fields). */
function propoBuildModel(opts) {
  const o = opts || {};
  const wmtr = (o.wmtr || "").trim();
  const vendor = (o.vendor || "").trim();
  const number = propoNumber(wmtr, vendor, o.poNumber);
  const last5 = poWmtrLast5(wmtr);
  return {
    date: (o.poDate || todayISO()).trim(),
    po_number: number,
    wmtr_text: wmtr || `WMTR #${last5}`,
    vendor,
    vendor_address: (o.vendorAddress || "").trim(),
    cost_amount: poFmtUsd(o.cost),
    notes: (o.notes || "").trim(),
    logo_uri: (typeof LOGO_TTI !== "undefined" ? LOGO_TTI : LOGO_LEFT), // TechTrans International wordmark
    safe_po: number.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, ""),
  };
}

/** Full printable HTML for the property PO (port of poRenderHtml with the three
 *  wording changes). Reuses PO_SUBJECT, PO_FAR_NOTE, PO_FOOTER and PO_CSS. */
function propoRenderHtml(model, docTitle) {
  const notesBlock = model.notes
    ? `<div class="para"><b>Comments:</b> ${escBr(model.notes)}</div>`
    : "";

  // Multi-line manual address renders with line breaks, like it was entered.
  const vendorAddrHtml = model.vendor_address ? escBr(model.vendor_address) : "";

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
        <div class="para">This PO is for ${esc(model.wmtr_text)}.</div>
        <div class="para">Awarded Price: ${esc(model.cost_amount)}</div>
        ${notesBlock}
      </div>
    </div>

    <div class="section">
      <div class="section-title">2. Vendor Information</div>
      <div class="vendor-block">
        <div class="para"><b>Vendor Name:</b> ${esc(model.vendor)}</div>
        <div class="para"><b>Address:</b> ${vendorAddrHtml}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">3. Justification: The following circumstances justify this Purchase Order:</div>
      <div class="para">${esc(PROPO_JUSTIFICATION)}</div>
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

/* Node test support (ignored by the browser) */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PROPO_JUSTIFICATION,
    propoVendorList, propoCustomAbbrev, propoNumber, propoBuildModel, propoRenderHtml,
  };
}
