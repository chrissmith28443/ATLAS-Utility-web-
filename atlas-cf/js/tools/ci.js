/* =========================================================================
   ATLAS Utility Web — tools/ci.js
   Commercial Invoice generator.
   Faithful port of:
     - services/ci_document.py  build_pages()  (5 items page 1, 15 per cont.)
     - templates/ci_document.html (Jinja -> JS template literals)
     - templates/ci.css           (embedded below, 11in x 8.5in landscape)
   ========================================================================= */

/* ---- Page builder (port of build_pages) ---- */

function ciBuildPages(data, opts) {
  const {
    userRemarks = "", printedName = "", title = "",
    invoiceDate = "", shipmentDate = "", shipmentComments = "",
    purpose = "", shipmentRef = "", contractNo = "",
  } = opts || {};

  const meta = data.meta;
  const parties = data.parties;
  const items = data.items;

  const FIRST_CAP = 5;
  const CONT_CAP = 15;

  const firstItems = items.slice(0, FIRST_CAP);
  const remaining = items.slice(FIRST_CAP);

  const pad = (arr, n) => {
    const out = arr.slice();
    while (out.length < n) out.push(makeLineItem());
    return out;
  };

  const pages = [];

  pages.push({
    is_first: true,
    invoice_no: meta.invoice_no,
    invoice_date: invoiceDate,
    purpose: purpose || meta.purpose || "",
    payment_terms: meta.payment_terms,
    payment_terms_remarks: meta.payment_terms_remarks,
    incoterm: meta.incoterm,
    contract_no: contractNo,
    shipment_ref_no: shipmentRef || meta.shipment_ref_no || "",
    shipment_date: shipmentDate,
    shipment_comments: shipmentComments,
    parties,
    line_items: pad(firstItems, FIRST_CAP),
    total_pkgs: meta.total_pkgs || "",
    total_weight: meta.total_weight || "",
    total_volume: meta.total_volume || "",
    total_value: meta.total_value || "",
    user_remarks: userRemarks,
    printed_name: printedName,
    title,
    sign_date: invoiceDate,
    prepared_by: CI_PREPARED_BY,
    declaration_text: CI_DECLARATION,
  });

  if (remaining.length) {
    const numCont = Math.ceil(remaining.length / CONT_CAP);
    for (let i = 0; i < numCont; i++) {
      let chunk = remaining.slice(i * CONT_CAP, (i + 1) * CONT_CAP);
      const subtotal = chunk.reduce(
        (s, it) => s + (it.total_value ? toFloat(it.total_value) : 0), 0);
      chunk = pad(chunk, CONT_CAP);
      pages.push({
        is_first: false,
        invoice_no: meta.invoice_no,
        invoice_date: invoiceDate,
        shipment_ref_no: shipmentRef || meta.shipment_ref_no || "",
        contract_no: contractNo,
        parties,
        line_items: chunk,
        page_subtotal: fmtMoney(subtotal),
        declaration_text: CI_DECLARATION,
      });
    }
  }

  return pages;
}

/* ---- HTML rendering (port of ci_document.html) ---- */

function ciAddrLines(party) {
  return party.addr_lines.map(esc).join("<br/>");
}

function ciPartyBox(label, party, withContact) {
  let contact = "";
  if (withContact) {
    contact = `
        <br/>
        <b>Contact Name:</b> ${esc(party.contact)}<br/>
        <b>Telephone No:</b> ${esc(party.phone)}<br/>
        <b>E-mail:</b> ${esc(party.email)}` +
      (party.tax_id ? `<br/><b>Tax ID:</b> ${esc(party.tax_id)}` : "");
  }
  return `
    <div class="box">
      <div class="section-label">${esc(label)}</div>
      <div class="section-value">
        <span class="addr-block">
          <span class="addr-6">${ciAddrLines(party)}</span>
        </span>
        <span class="country"><b>Country:</b> ${esc(party.country)}</span>
        ${contact}
      </div>
    </div>`;
}

function ciItemRows(lineItems) {
  return lineItems.map((it) => `
      <tr>
        <td class="center">${esc(it.line)}</td>
        <td class="center">${esc(it.units)}</td>
        <td class="center">${esc(it.uom)}</td>
        <td>${esc(it.desc)}</td>
        <td class="center">${esc(it.model)}</td>
        <td class="center">${esc(it.hts)}</td>
        <td class="center">${esc(it.eccn)}</td>
        <td class="center">${esc(it.auth)}</td>
        <td class="center">${esc(it.coo)}</td>
        <td class="right">${esc(it.unit_value)}</td>
        <td class="right">${esc(it.total_value)}</td>
      </tr>`).join("");
}

function ciItemsTable(lineItems) {
  return `
  <table class="table" style="margin-top:4px;">
    <thead>
      <tr>
        <th style="width:4%;">Line</th>
        <th style="width:5%;">Units</th>
        <th style="width:5%;">UOM</th>
        <th style="width:26%;">Description of Goods</th>
        <th style="width:10%;">Model/Cat</th>
        <th style="width:10%;">HTS/Sched B</th>
        <th style="width:9%;">USML/ECCN</th>
        <th style="width:9%;">Authorization</th>
        <th style="width:8%;">COO</th>
        <th style="width:7%;">Unit Value</th>
        <th style="width:7%;">Total Value</th>
      </tr>
    </thead>
    <tbody>${ciItemRows(lineItems)}
    </tbody>
  </table>`;
}

function ciRenderPage(p, pageIdx, totalPages) {
  if (p.is_first) {
    return `
<div class="page">
  <div class="header">
    <div class="header-logo left"><img src="${LOGO_LEFT}" alt="Left Logo"></div>
    <div class="header-center">
      <div class="header-subtitle">${esc(p.declaration_text)}</div>
      <div class="header-title">COMMERCIAL INVOICE</div>
    </div>
    <div class="header-logo right"><img src="${LOGO_RIGHT}" alt="Right Logo"></div>
  </div>

  <div class="page-num page-num--p1">
    <span class="pn-word">Page</span> ${pageIdx} <span class="pn-word">of</span> ${totalPages}
  </div>

  <div class="meta-grid">
    <div class="field m-invno"><div class="label">Invoice No</div><div class="value">${esc(p.invoice_no)}</div></div>
    <div class="field m-invdate"><div class="label">Invoice Date</div><div class="value">${esc(p.invoice_date)}</div></div>
    <div class="field m-purpose"><div class="label">Purpose of Shipment</div><div class="value">${esc(p.purpose)}</div></div>
    <div class="field m-payterms"><div class="label">Payment Terms</div><div class="value">${esc(p.payment_terms)}</div></div>
    <div class="field m-payremarks"><div class="label">Payment Terms Remarks</div><div class="value">${esc(p.payment_terms_remarks)}</div></div>
    <div class="field m-incoterm"><div class="label">IncoTerms</div><div class="value">${esc(p.incoterm)}</div></div>
    <div class="field m-contract"><div class="label">Contract No</div><div class="value">${esc(p.contract_no)}</div></div>

    <div class="field m-shipref"><div class="label">Shipment Ref No</div><div class="value">${esc(p.shipment_ref_no)}</div></div>
    <div class="field m-shipdate"><div class="label">Shipment Date</div><div class="value">${esc(p.shipment_date)}</div></div>
    <div class="field m-shipcomments"><div class="label">Shipment Comments</div><div class="value">${esc(p.shipment_comments)}</div></div>
  </div>

  <div class="grid">
    ${ciPartyBox("ORIGIN", p.parties.origin, true)}
    ${ciPartyBox("CONSIGNEE", p.parties.consignee, true)}
    ${ciPartyBox("END USER", p.parties.end_user, true)}
  </div>

  <div class="row">
    <div class="field">
      <div class="section-label">PICKUP LOCATION</div>
      <div class="section-value">
        <span class="addr-block"><span class="addr-6">${ciAddrLines(p.parties.pickup)}</span></span>
        <span class="country"><b>Country:</b> ${esc(p.parties.pickup.country)}</span>
      </div>
    </div>
    <div class="field">
      <div class="section-label">DELIVER TO LOCATION</div>
      <div class="section-value">
        <span class="addr-block"><span class="addr-6">${ciAddrLines(p.parties.deliver)}</span></span>
        <span class="country"><b>Country:</b> ${esc(p.parties.deliver.country)}</span>
      </div>
    </div>
  </div>

  ${ciItemsTable(p.line_items)}

  <div class="bottom-stack">
    <div class="footer">
      <div class="footer-totals">
        <div class="tcell"><span class="tlabel">Tot no of Packages:</span> <span class="tval">${esc(p.total_pkgs)}</span></div>
        <div class="tcell"><span class="tlabel">Tot Weight:</span> <span class="tval">${esc(p.total_weight)}</span></div>
        <div class="tcell"><span class="tlabel">Tot Volume:</span> <span class="tval">${esc(p.total_volume)}</span></div>
        <div class="tcell"><span class="tlabel">Total Value (USD):</span> <span class="tval">${esc(p.total_value)}</span></div>
      </div>

      <div class="footer-bottom">
        <div class="remarks">
          <div class="label">Remarks:</div>
          <div class="remarks-body">
            ${CI_REMARKS_BOILERPLATE}<br/>
            ${escBr(p.user_remarks)}
          </div>
        </div>

        <div class="sign-area">
          <div class="fieldbox sign-printed"><div class="label">Printed Name:</div><div class="value">${esc(p.printed_name)}</div></div>
          <div class="sigbox sign-signature"><div class="label">Signature:</div><div class="sig-blank"></div></div>
          <div class="fieldbox sign-title"><div class="label">Title:</div><div class="value">${esc(p.title)}</div></div>
          <div class="fieldbox sign-date"><div class="label">Date:</div><div class="value">${esc(p.sign_date)}</div></div>
        </div>
      </div>
    </div>

    <div class="page-bottom">
      <div class="prepared-by">${esc(p.prepared_by)}</div>
      <div class="declaration">${esc(p.declaration_text)}</div>
    </div>
  </div>
</div>`;
  }

  /* Continuation page */
  return `
<div class="page">
  <div class="cont-header"><div class="cont-title">COMMERCIAL INVOICE</div></div>

  <div class="page-num page-num--cont">
    <span class="pn-word">Page</span> ${pageIdx} <span class="pn-word">of</span> ${totalPages}
  </div>

  <div class="cont-grid">
    ${ciPartyBox("ORIGIN", p.parties.origin, false)}
    ${ciPartyBox("CONSIGNEE", p.parties.consignee, false)}
    ${ciPartyBox("END USER", p.parties.end_user, false)}
  </div>

  <div class="cont-meta-row">
    <div class="field"><div class="label">Invoice No</div><div class="value">${esc(p.invoice_no)}</div></div>
    <div class="field"><div class="label">Invoice Date</div><div class="value">${esc(p.invoice_date)}</div></div>
    <div class="field"><div class="label">Shipment Ref No</div><div class="value">${esc(p.shipment_ref_no)}</div></div>
    <div class="field"><div class="label">Contract No</div><div class="value">${esc(p.contract_no)}</div></div>
  </div>

  <div class="cont-table-wrap">
  ${ciItemsTable(p.line_items)}

    <div class="footer footer--cont">
      <div class="footer-subtotal">
        <span>Subtotal:</span>
        <span class="value">${esc(p.page_subtotal)}</span>
      </div>
    </div>
  </div>
</div>`;
}

/** Full printable HTML document for the CI. */
function ciRenderHtml(pages, docTitle) {
  const body = pages.map((p, i) => ciRenderPage(p, i + 1, pages.length)).join("\n");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(docTitle)}</title>
<style>
${CI_CSS}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/* ---- ci.css, embedded verbatim from desktop templates/ci.css ---- */

const CI_CSS = `
@page{
  size: 11in 8.5in;
  margin: 0.35in;
}

:root{ --ci-gray:#f2f2f2; }

html, body{ margin:0; padding:0; }

body{
  font-family: Arial, Helvetica, sans-serif;
  font-size: 10pt;
  line-height: 1.15;
  color: #000;
}

/* =========================
   PAGE — REAL PAPER PREVIEW
   ========================= */
.page{
  box-sizing: border-box;
  width: 10.3in;   /* 11in − 0.35in − 0.35in */
  min-height: 7.8in;
  height: auto;
  margin: 0px auto;
  padding: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 0px solid #bbb;
  box-shadow: 0 0 10px rgba(0,0,0,0.25);
  position: relative;
  break-after: auto;
  page-break-after: auto;
}

.page + .page{
  break-before: page;
  page-break-before: always;
}

/* =========================
   PAGE 1 HEADER (LOGOS + TITLE)
   ========================= */
.header{
  display: grid;
  grid-template-columns: 1.2fr 3.6fr 1.2fr;
  align-items: center;
  margin-bottom: 2px;
}
.header-center{ text-align: center; line-height: 1.05; }
.header-subtitle{
  font-size: 8pt;
  font-weight: bold;
  color: #b00000;
  text-transform: uppercase;
  margin: 0 0 1px 0;
}
.header-title{
  font-size: 14pt;
  font-weight: bold;
  color: #000;
  margin: 0;
}
.header-logo{ display: flex; align-items: center; }
.header-logo.left{ justify-content: flex-start; }
.header-logo.right{ justify-content: flex-end; }
.header-logo img{
  max-height: 60px;
  max-width: 100%;
  object-fit: contain;
  display: block;
}

/* =========================
   CONTINUATION PAGE HEADER
   ========================= */
.cont-header{
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px 0;
  margin-bottom: 0;
}
.cont-title{
  font-size: 14pt;
  font-weight: bold;
  color: #000;
  line-height: 1.15;
  text-align: center;
}

/* =========================
   PAGE NUMBER
   ========================= */
.page-num{
  font-size: 7pt;
  line-height: 1.10;
  text-align: right;
  padding-right: 10px;
}
.page-num--p1{ margin: 1px 0 4px 0; }
.page-num--cont{ margin: 2px 0 4px 0; }
.page-num .pn-word{ font-weight: bold; }

/* =========================
   META GRID (Page 1)
   ========================= */
.meta-grid{
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0;
  margin-bottom: 0;
  border: .75pt solid #000;
}

.meta-grid .field{
  padding: 0;
  display: flex;
  flex-direction: column;
  border: 0;
}

.meta-grid .label{
  background-color: var(--ci-gray);
  font-size: 8pt;
  font-weight: bold;
  line-height: 1.15;
  padding: 2px 3px;
  margin: 0;
  display: block;
  background-clip: padding-box;
  border: 0.25pt solid transparent;
}

.meta-grid .value{
  font-size: 7pt;
  font-weight: normal;
  line-height: 1.15;
  padding: 3px 4px 4px 4px;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-left: 0;
  border-bottom: 0;
  min-height: 1.15em;
}

/* placement helpers (Page 1) */
.m-invno      { grid-column: 1; grid-row: 1; }
.m-invdate    { grid-column: 2; grid-row: 1; }
.m-purpose    { grid-column: 3; grid-row: 1; }
.m-payterms   { grid-column: 4; grid-row: 1; }
.m-payremarks { grid-column: 5; grid-row: 1; }
.m-incoterm   { grid-column: 6; grid-row: 1; }
.m-contract   { grid-column: 7; grid-row: 1; }
.m-shipref      { grid-column: 1; grid-row: 2; }
.m-shipdate     { grid-column: 2; grid-row: 2; }
.m-shipcomments { grid-column: 3 / span 5; grid-row: 2; }

/* ======================================================================
   ORIGIN / CONSIGNEE / END USER + PICKUP / DELIVER
   ====================================================================== */
.addr-block{ display: block; margin-top: 3px; }

.addr-5{
  display: block;
  line-height: 1.15;
  height: calc(5 * 1.15em);
  overflow: hidden;
}

.addr-6{
  display: block;
  line-height: 1.10;
  height: calc(6 * 1.10em);
  overflow: hidden;
}

.country{
  display: block;
  margin-top: 3px;
  margin-bottom: 1px;
  line-height: 1.05;
}

/* 3-up */
.grid{
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border: 1px solid #000;
  margin-top: 4px;
  gap: 0;
}
.grid .box{
  display: flex;
  flex-direction: column;
  padding: 0;
  border: 0;
}
.grid .box + .box{ border-left: 1px solid #000; }

.grid .section-label{
  background-color: var(--ci-gray);
  font-size: 7pt;
  font-weight: bold;
  padding: 2px 5px;
  margin: 0;
  line-height: 1.05;
  border-bottom: none;
  background-clip: padding-box;
  border: 0.25pt solid transparent;
}

.grid .section-value{
  font-size: 7pt;
  line-height: 1.10;
  padding: 4px 5px;
}

/* 2-up pickup/deliver */
.row{
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  margin-top: 0;
  border-left: 1px solid #000;
  border-right: 1px solid #000;
  border-bottom: 1px solid #000;
}
.row > .field{
  display: flex;
  flex-direction: column;
  padding: 0;
  border: 0;
  min-height: 0;
}
.row > .field + .field{ border-left: 1px solid #000; }

.row .section-label{
  background-color: var(--ci-gray);
  font-size: 7pt;
  font-weight: bold;
  padding: 2px 5px;
  margin: 0;
  line-height: 1.05;
  border-bottom: none;
  background-clip: padding-box;
  border: 0.25pt solid transparent;
}
.row .section-value{
  font-size: 7pt;
  line-height: 1.10;
  padding: 0px 5px 3px 5px;
}
.row .addr-block{ display: inline; margin-top: 0; }
.row .addr-6{ margin-top: 0; }
.row .country{ margin-top: 2px; }

/* =========================
   CONTINUATION: Address-only 3-up grid
   ========================= */
.cont-grid{
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border: 1px solid #000;
  margin-top: 0;
  gap: 0;
}
.cont-grid .box{ display: flex; flex-direction: column; padding: 0; border: 0; }
.cont-grid .box + .box{ border-left: 1px solid #000; }
.cont-grid .section-label{
  background-color: var(--ci-gray);
  font-size: 7pt;
  font-weight: bold;
  padding: 2px 5px;
  margin: 0;
  line-height: 1.05;
  border-bottom: none;
  background-clip: padding-box;
  border: 0.25pt solid transparent;
}

.cont-grid .section-value{
  font-size: 7pt;
  line-height: 1.10;
  padding: 4px 5px;
}
.cont-grid .addr-6{
  display: block;
  line-height: 1.10;
  height: calc(6 * 1.10em);
  overflow: hidden;
}
.cont-grid .country{
  display: block;
  margin-top: 3px;
  margin-bottom: 1px;
  line-height: 1.05;
}

/* =========================
   CONTINUATION: Compact meta row
   ========================= */
.cont-meta-row{
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
  border-left: 1px solid #000;
  border-right: 1px solid #000;
  border-bottom: 1px solid #000;
  margin-top: 0;
}
.cont-meta-row .field{ display: flex; flex-direction: column; }
.cont-meta-row .field + .field{ border-left: 1px solid #000; }
.cont-meta-row .label{
  background-color: var(--ci-gray);
  font-size: 8pt;
  font-weight: bold;
  padding: 2px 4px;
  line-height: 1.10;
  background-clip: padding-box;
  border: 0.25pt solid transparent;
}

.cont-meta-row .value{
  font-size: 7pt;
  padding: 2px 4px 3px 4px;
  line-height: 1.10;
}

/* table wrapper spacing */
.cont-table-wrap{ margin-top: 4px; margin-bottom: 0; }

/* =========================
   LINE ITEMS TABLE
   ========================= */
.table{
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 8pt;
  line-height: 1.15;
}
.table thead th{
  background-color: var(--ci-gray);
  border: 1px solid #000;
  padding: 3px 4px;
  font-weight: bold;
  font-size: 8pt;
  line-height: 1.15;
  text-align: center;
  vertical-align: middle;
}

.table tbody td{
  border-left: 1px solid #000;
  border-right: 1px solid #000;
  border-top: none;
  border-bottom: none;
  padding: 3px 4px;
  font-size: 8pt;
  line-height: 1.15;
  vertical-align: middle;
  text-align: center;
  word-wrap: break-word;
  overflow-wrap: break-word;
  height: 26px;
}
.table tbody tr:last-child td{ border-bottom: 1px solid #000; }
.center{ text-align: center !important; }
.right{  text-align: right  !important; }

/* =========================
   BOTTOM STACK (Page 1)
   ========================= */
.bottom-stack{
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* Page 1 footer */
.footer{
  margin-top: 0;
  border: 0;
  padding: 4px;
  page-break-inside: avoid;
  font-size: 8pt;
  line-height: 1.10;
}
.footer-totals{
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid #000;
  border-bottom: 1px solid #000;
  padding: 5px 4px;
  column-gap: 10px;
  background-color: var(--ci-gray);
  font-size: 8pt;
  line-height: 1.10;
}

.footer-totals .tcell{
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  font-weight: normal;
}
.footer-totals .tlabel{ font-weight: bold; margin-right: 6px; }

.footer-bottom{
  display: grid;
  grid-template-columns: 2fr 1.5fr;
  gap: 6px;
  margin-top: 2px;
  align-items: stretch;
}

/* Remarks — exactly 8 lines tall */
.remarks{
  border: none;
  padding: 2px;
  font-size: 7pt;
  line-height: 1.10;
  height: calc(8 * 1.10em);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
.remarks-body{
  flex: 1 1 auto;
  padding-bottom: calc(2 * 1.10em);
  overflow: hidden;
}

.sign-area{
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto auto;
  row-gap: 2px;
  column-gap: 6px;
}
.sign-printed   { grid-column: 1; grid-row: 1; }
.sign-signature { grid-column: 2; grid-row: 1; }
.sign-title     { grid-column: 1; grid-row: 2; }
.sign-date      { grid-column: 2; grid-row: 2; }

.fieldbox, .sigbox{
  border: none;
  padding: 2px;
  display: flex;
  flex-direction: column;
  font-size: 8pt;
  line-height: 1.10;
}
.sig-blank{ flex: 1 1 auto; border: none; }

.footer .label{
  font-weight: bold;
  font-size: 8pt;
  line-height: 1.10;
}

/* Page 1 bottom band */
.page-bottom{ position: static; }

.prepared-by{
  border-top: 1px solid #000;
  border-bottom: 1px solid #000;
  padding: 3px 6px;
  font-size: 8pt;
  line-height: 1.10;
  text-align: left;
  margin-bottom: 3px;
  font-weight: bold;
  font-style: italic;
  background-color: var(--ci-gray);
}
.declaration{
  text-align: center;
  font-size: 8pt;
  line-height: 1.10;
  font-weight: bold;
  color: #b00000;
  letter-spacing: 0.2px;
  margin-top: 12px;
  margin-bottom: 12px;
}

/* =========================
   CONTINUATION SUBTOTAL STRIP
   ========================= */
.footer--cont{
  margin-top: 0;
  border-top: 1px solid #000;
  padding: 2px 6px;
  background: var(--ci-gray);
}
.footer-subtotal{
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  font-weight: bold;
  font-size: 8pt;
  line-height: 1.10;
  margin: 0;
}
.footer-subtotal .value{
  min-width: 90px;
  text-align: right;
}

/* =========================
   HARD LOCKS AGAINST OVERFLOW
   ========================= */
.meta-grid, .grid, .row, .cont-grid, .cont-meta-row { flex: 0 0 auto; }

.meta-grid .value, .grid .section-value, .row .section-value, .cont-grid .section-value{
  overflow: hidden;
}

.table tbody tr{ height: 26px; }

.cont-table-wrap{ margin-bottom: 0; }

@media print {
  .page{
    margin: 0 !important;
    border: none !important;
    box-shadow: none !important;

    /* HARD CLAMP so the browser cannot spill onto a 2nd page */
    height: 7.8in !important;
    min-height: 0 !important;
    overflow: hidden !important;
  }
}
`;

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ciBuildPages, ciRenderHtml };
  const u = require("../util.js");
  for (const k of Object.keys(u)) global[k] = u[k];
  const c = require("../constants.js");
  for (const k of Object.keys(c)) global[k] = c[k];
  const q = require("../udq.js");
  global.makeLineItem = q.makeLineItem;
  const a = require("../assets.js");
  global.LOGO_LEFT = a.LOGO_LEFT;
  global.LOGO_RIGHT = a.LOGO_RIGHT;
}
