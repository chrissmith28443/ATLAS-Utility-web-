/* =========================================================================
   ATLAS Utility Web — tools/rfq_template.js
   The RFQ email body (HTML). Redesigned in 2.9.17: same wording, fields and
   order as the desktop template it replaced, in a cleaner layout — steel-blue
   title rule, blue-grey section bars, hairline borders instead of black, the
   two totals on a soft highlight.

   It is an EMAIL, opened in Outlook (which draws HTML with Word's engine), so
   it is deliberately old-fashioned: one fixed 700px table, widths on every
   cell, bgcolor + inline styles, no CSS classes, no flex, no images. Keep it
   that way when editing. The package rows come from rfq.js rfqRenderItemRows;
   its seven cells must match the seven columns here (250/100/60/65/65/65/95).
   ========================================================================= */

const RFQ_TEMPLATE_HTML = String.raw`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>RFQ Email</title>
</head>
<body style="margin:0;padding:0;font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1F2A37">
<!--
Placeholders:
  {RFQ_NUMBER} {WMTR_NUMBER} {RESPONSE_DATE} {RFQ_DESCRIPTION}
  {PICKUP_LOCATION_BLOCK} {DELIVERY_DESTINATION_BLOCK}
  {TOTAL_PACKAGE_COUNT} {FINAL_TOTAL_CGO_WEIGHT}
  {INSURED_VALUE_USD} {INCLUDES_EAR_ITAR} {INCLUDES_DANGEROUS_GOODS} {TEMPERATURE_CONTROL} {REQUESTED_MODE}
Marker: ITEM_ROWS (rfq.js rfqRenderItemRows writes the package rows; its cells must match the 7 columns below)
-->

<p style="margin:0 0 10px 0;font-family:Calibri,Arial,sans-serif;font-size:12pt">Greetings!</p>
<p style="margin:0 0 14px 0;font-family:Calibri,Arial,sans-serif;font-size:12pt">TechTrans International would like to invite you to submit your bid for the services listed below in support of the Threat Reduction Logistics Services (TRLS II) contract.</p>

<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="700" style="width:700px;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1F2A37">

 <!-- title -->
 <tr>
  <td colspan="7" style="padding:0 0 8px 0;border-bottom:3px solid #2F496F">
   <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="700" style="width:700px;border-collapse:collapse">
    <tr>
     <td valign="bottom" style="font-family:Calibri,Arial,sans-serif;font-size:22pt;font-weight:bold;color:#2F496F;line-height:1.1">Request for Quote</td>
     <td valign="bottom" align="right" style="font-family:Calibri,Arial,sans-serif;font-size:9.5pt;color:#5B6B7C;line-height:1.3;text-align:right">TechTrans International &middot; TRLS II<br><span style="font-size:13pt;font-weight:bold;color:#1F2A37">{RFQ_NUMBER}</span></td>
    </tr>
   </table>
  </td>
 </tr>
 <tr><td colspan="7" style="height:12px;font-size:1px;line-height:1px">&nbsp;</td></tr>

 <!-- RFQ details -->
 <tr>
  <td colspan="7" bgcolor="#CDD3DC" style="background:#CDD3DC;padding:5px 10px;font-size:10.5pt;font-weight:bold;color:#16283C;border:1px solid #AEB8C6;border-bottom:2px solid #2F496F">RFQ Details</td>
 </tr>
 <tr>
  <td width="250" bgcolor="#EEF1F5" style="width:250px;background:#EEF1F5;padding:5px 10px;border:1px solid #C3CAD5;border-top:none;font-weight:bold;color:#2B3A4D">RFQ Number</td>
  <td colspan="6" style="padding:5px 10px;border:1px solid #C3CAD5;border-top:none;border-left:none">{RFQ_NUMBER}</td>
 </tr>
 <tr>
  <td width="250" bgcolor="#EEF1F5" style="width:250px;background:#EEF1F5;padding:5px 10px;border:1px solid #C3CAD5;border-top:none;font-weight:bold;color:#2B3A4D">WMTR Number</td>
  <td colspan="6" style="padding:5px 10px;border:1px solid #C3CAD5;border-top:none;border-left:none">{WMTR_NUMBER}</td>
 </tr>
 <tr>
  <td width="250" bgcolor="#EEF1F5" style="width:250px;background:#EEF1F5;padding:5px 10px;border:1px solid #C3CAD5;border-top:none;font-weight:bold;color:#2B3A4D">Requested Response Date</td>
  <td colspan="6" style="padding:5px 10px;border:1px solid #C3CAD5;border-top:none;border-left:none;font-weight:bold">{RESPONSE_DATE}</td>
 </tr>
 <tr>
  <td width="250" valign="top" bgcolor="#EEF1F5" style="width:250px;background:#EEF1F5;padding:5px 10px;border:1px solid #C3CAD5;border-top:none;font-weight:bold;color:#2B3A4D">RFQ Description/Comments</td>
  <td colspan="6" valign="top" style="padding:5px 10px;border:1px solid #C3CAD5;border-top:none;border-left:none">{RFQ_DESCRIPTION}</td>
 </tr>
 <tr><td colspan="7" style="height:14px;font-size:1px;line-height:1px">&nbsp;</td></tr>

 <!-- Shipping & delivery -->
 <tr>
  <td colspan="7" bgcolor="#CDD3DC" style="background:#CDD3DC;padding:5px 10px;font-size:10.5pt;font-weight:bold;color:#16283C;border:1px solid #AEB8C6;border-bottom:2px solid #2F496F">Shipping &amp; Delivery Requirements</td>
 </tr>
 <tr>
  <td colspan="2" width="350" bgcolor="#EEF1F5" style="width:350px;background:#EEF1F5;padding:5px 10px;border:1px solid #C3CAD5;border-top:none;font-weight:bold;color:#2B3A4D">Pickup Location</td>
  <td colspan="5" width="350" bgcolor="#EEF1F5" style="width:350px;background:#EEF1F5;padding:5px 10px;border:1px solid #C3CAD5;border-top:none;border-left:none;font-weight:bold;color:#2B3A4D">Delivery Destination</td>
 </tr>
 <tr>
  <td colspan="2" width="350" valign="top" style="width:350px;padding:7px 10px 9px 10px;border:1px solid #C3CAD5;border-top:none;line-height:1.35">{PICKUP_LOCATION_BLOCK}</td>
  <td colspan="5" width="350" valign="top" style="width:350px;padding:7px 10px 9px 10px;border:1px solid #C3CAD5;border-top:none;border-left:none;line-height:1.35">{DELIVERY_DESTINATION_BLOCK}</td>
 </tr>
 <tr>
  <td colspan="2" width="350" bgcolor="#EEF1F5" style="width:350px;background:#EEF1F5;padding:6px 10px;border:1px solid #C3CAD5;border-top:none;font-weight:bold;color:#2B3A4D">Total Package Count</td>
  <td colspan="5" width="350" align="center" bgcolor="#FFF4CC" style="width:350px;background:#FFF4CC;padding:6px 10px;border:1px solid #C3CAD5;border-top:none;border-left:none;text-align:center;font-size:12pt;font-weight:bold;color:#16283C">{TOTAL_PACKAGE_COUNT}</td>
 </tr>
 <tr>
  <td colspan="2" width="350" bgcolor="#EEF1F5" style="width:350px;background:#EEF1F5;padding:6px 10px;border:1px solid #C3CAD5;border-top:none;font-weight:bold;color:#2B3A4D">Estimated Total Cargo Weight</td>
  <td colspan="5" width="350" align="center" bgcolor="#FFF4CC" style="width:350px;background:#FFF4CC;padding:6px 10px;border:1px solid #C3CAD5;border-top:none;border-left:none;text-align:center;font-size:12pt;font-weight:bold;color:#16283C">{FINAL_TOTAL_CGO_WEIGHT}</td>
 </tr>

 <!-- package rows -->
 <tr>
  <td width="250" bgcolor="#E3E7ED" style="width:250px;background:#E3E7ED;padding:5px 10px;border:1px solid #C3CAD5;border-top:none;font-size:9pt;font-weight:bold;color:#2F496F">Item Description</td>
  <td width="100" align="center" bgcolor="#E3E7ED" style="width:100px;background:#E3E7ED;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none;font-size:9pt;font-weight:bold;color:#2F496F;text-align:center">Qty</td>
  <td width="60" align="center" bgcolor="#E3E7ED" style="width:60px;background:#E3E7ED;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none;font-size:9pt;font-weight:bold;color:#2F496F;text-align:center">U/I</td>
  <td width="65" align="center" bgcolor="#E3E7ED" style="width:65px;background:#E3E7ED;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none;font-size:9pt;font-weight:bold;color:#2F496F;text-align:center">Ln (in)</td>
  <td width="65" align="center" bgcolor="#E3E7ED" style="width:65px;background:#E3E7ED;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none;font-size:9pt;font-weight:bold;color:#2F496F;text-align:center">Wd (in)</td>
  <td width="65" align="center" bgcolor="#E3E7ED" style="width:65px;background:#E3E7ED;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none;font-size:9pt;font-weight:bold;color:#2F496F;text-align:center">Ht (in)</td>
  <td width="95" align="center" bgcolor="#E3E7ED" style="width:95px;background:#E3E7ED;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none;font-size:9pt;font-weight:bold;color:#2F496F;text-align:center">Weight (lbs)</td>
 </tr>

<!--ITEM_ROWS-->

 <tr>
  <td width="250" style="width:250px;padding:5px 10px;border:1px solid #C3CAD5;border-top:none">&nbsp;</td>
  <td width="100" style="width:100px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
  <td width="60" style="width:60px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
  <td width="65" style="width:65px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
  <td width="65" style="width:65px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
  <td width="65" style="width:65px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
  <td width="95" style="width:95px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
 </tr>
 <tr>
  <td width="250" style="width:250px;padding:5px 10px;border:1px solid #C3CAD5;border-top:none">&nbsp;</td>
  <td width="100" style="width:100px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
  <td width="60" style="width:60px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
  <td width="65" style="width:65px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
  <td width="65" style="width:65px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
  <td width="65" style="width:65px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
  <td width="95" style="width:95px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
 </tr>
 <tr>
  <td width="250" style="width:250px;padding:5px 10px;border:1px solid #C3CAD5;border-top:none">&nbsp;</td>
  <td width="100" style="width:100px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
  <td width="60" style="width:60px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
  <td width="65" style="width:65px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
  <td width="65" style="width:65px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
  <td width="65" style="width:65px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
  <td width="95" style="width:95px;padding:5px 4px;border:1px solid #C3CAD5;border-top:none;border-left:none">&nbsp;</td>
 </tr>
 <tr><td colspan="7" style="height:14px;font-size:1px;line-height:1px">&nbsp;</td></tr>

 <!-- Special handling -->
 <tr>
  <td colspan="7" bgcolor="#CDD3DC" style="background:#CDD3DC;padding:5px 10px;font-size:10.5pt;font-weight:bold;color:#16283C;border:1px solid #AEB8C6;border-bottom:2px solid #2F496F">Special Handling</td>
 </tr>
 <tr>
  <td width="250" bgcolor="#EEF1F5" style="width:250px;background:#EEF1F5;padding:5px 10px;border:1px solid #C3CAD5;border-top:none;font-weight:bold;color:#2B3A4D">Insured Value (USD)?</td>
  <td colspan="6" style="padding:5px 10px;border:1px solid #C3CAD5;border-top:none;border-left:none;font-weight:bold">{INSURED_VALUE_USD}</td>
 </tr>
 <tr>
  <td width="250" bgcolor="#EEF1F5" style="width:250px;background:#EEF1F5;padding:5px 10px;border:1px solid #C3CAD5;border-top:none;font-weight:bold;color:#2B3A4D">Includes ITAR/EAR?</td>
  <td colspan="6" style="padding:5px 10px;border:1px solid #C3CAD5;border-top:none;border-left:none;font-weight:bold">{INCLUDES_EAR_ITAR}</td>
 </tr>
 <tr>
  <td width="250" bgcolor="#EEF1F5" style="width:250px;background:#EEF1F5;padding:5px 10px;border:1px solid #C3CAD5;border-top:none;font-weight:bold;color:#2B3A4D">Includes Dangerous Goods?</td>
  <td colspan="6" style="padding:5px 10px;border:1px solid #C3CAD5;border-top:none;border-left:none;font-weight:bold">{INCLUDES_DANGEROUS_GOODS}</td>
 </tr>
 <tr>
  <td width="250" bgcolor="#EEF1F5" style="width:250px;background:#EEF1F5;padding:5px 10px;border:1px solid #C3CAD5;border-top:none;font-weight:bold;color:#2B3A4D">Temperature-Control?</td>
  <td colspan="6" style="padding:5px 10px;border:1px solid #C3CAD5;border-top:none;border-left:none;font-weight:bold">{TEMPERATURE_CONTROL}</td>
 </tr>
 <tr>
  <td width="250" bgcolor="#EEF1F5" style="width:250px;background:#EEF1F5;padding:5px 10px;border:1px solid #C3CAD5;border-top:none;font-weight:bold;color:#2B3A4D">Requested Mode of Transit?</td>
  <td colspan="6" style="padding:5px 10px;border:1px solid #C3CAD5;border-top:none;border-left:none;font-weight:bold">{REQUESTED_MODE}</td>
 </tr>
 <tr><td colspan="7" style="height:16px;font-size:1px;line-height:1px">&nbsp;</td></tr>

 <!-- what every quote must include -->
 <tr>
  <td colspan="7" style="padding:0 0 6px 0;font-size:11.5pt;font-weight:bold;color:#2F496F">Please ensure all quotes include the following:</td>
 </tr>
 <tr>
  <td colspan="7" style="padding:0">
   <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="700" style="width:700px;border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1F2A37">
    <tr><td width="26" valign="top" style="width:26px;padding:2px 0 2px 8px;font-weight:bold;color:#1E7F4F">&#10003;</td><td valign="top" style="padding:2px 0">Total cost (including all standard fees)</td></tr>
    <tr><td width="26" valign="top" style="width:26px;padding:2px 0 2px 8px;font-weight:bold;color:#1E7F4F">&#10003;</td><td valign="top" style="padding:2px 0">Estimated total transit time from pickup to final delivery</td></tr>
    <tr><td width="26" valign="top" style="width:26px;padding:2px 0 2px 8px;font-weight:bold;color:#1E7F4F">&#10003;</td><td valign="top" style="padding:2px 0">Routing details, including all transit airports and carriers used</td></tr>
    <tr><td width="26" valign="top" style="width:26px;padding:2px 0 2px 8px;font-weight:bold;color:#1E7F4F">&#10003;</td><td valign="top" style="padding:2px 0">When requested, cargo insurance in accordance with FAR 52.247-22 and DFARS 252.247-7007</td></tr>
    <tr><td width="26" valign="top" style="width:26px;padding:2px 0 2px 8px;font-weight:bold;color:#1E7F4F">&#10003;</td><td valign="top" style="padding:2px 0">Statement of DG/HAZMAT acceptance and any limitations</td></tr>
    <tr><td width="26" valign="top" style="width:26px;padding:2px 0 2px 8px;font-weight:bold;color:#1E7F4F">&#10003;</td><td valign="top" style="padding:2px 0">Demurrage and storage charges applicable after free time at destination</td></tr>
    <tr><td width="26" valign="top" style="width:26px;padding:2px 0 2px 8px;font-weight:bold;color:#1E7F4F">&#10003;</td><td valign="top" style="padding:2px 0">Routing and US Flag carrier details. <b><u>US Flag carrier must be used</u></b> unless explicitly exempted.</td></tr>
   </table>
  </td>
 </tr>
 <tr>
  <td colspan="7" style="padding:10px 0 0 0;font-weight:bold;color:#16283C">Failure to provide the above information may result in disqualification or delays in award determination.</td>
 </tr>
 <tr><td colspan="7" style="height:16px;font-size:1px;line-height:1px">&nbsp;</td></tr>

 <!-- notice -->
 <tr>
  <td colspan="7" bgcolor="#F4F6F8" style="background:#F4F6F8;padding:10px 14px 4px 14px;border:1px solid #D5DAE2;border-left:4px solid #2F496F;font-size:10pt;line-height:1.4;color:#33414F">
   <p style="margin:0 0 6px 0;font-family:Calibri,Arial,sans-serif;font-size:10.5pt;font-weight:bold;color:#2F496F">Government Property / Export Control Notice</p>
   <p style="margin:0 0 8px 0;font-family:Calibri,Arial,sans-serif;font-size:10pt">The items associated with this request are U.S. Government property and may be subject to export controls under the International Traffic in Arms Regulations (ITAR, 22 CFR 120&ndash;130) or the Export Administration Regulations (EAR, 15 CFR 730&ndash;774). Vendor is responsible for ensuring compliance with all applicable U.S. export laws and regulations.</p>
   <p style="margin:0 0 8px 0;font-family:Calibri,Arial,sans-serif;font-size:10pt">Diversion contrary to U.S. law is prohibited. Goods may not be transferred, transshipped, or disclosed to foreign nationals or entities without express U.S. Government authorization. For shipments subject to EAR or ITAR controls, if routing includes third-country transit (e.g., via Turkey, Germany, UAE), all items must remain in bonded transit. No transloading, customs clearance, or handling by unauthorized foreign parties is permitted. Vendors must ensure shipments remain sealed, secured, and in airport transit zones only until arrival at the final destination.</p>
   <p style="margin:0 0 8px 0;font-family:Calibri,Arial,sans-serif;font-size:10pt">Government-furnished equipment may qualify for duty-free, tax-exempt treatment under bilateral agreements or status-of-forces arrangements. Vendor must coordinate with consignee and/or TTI to ensure proper customs clearance procedures are followed.</p>
  </td>
 </tr>
</table>
<p style="margin:10px 0 0 0;font-family:Calibri,Arial,sans-serif;font-size:12pt">&nbsp;</p>
<p style="margin:0;font-family:Calibri,Arial,sans-serif;font-size:12pt">&nbsp;</p>
</body>
</html>
`;

function rfqTemplateHtml() { return RFQ_TEMPLATE_HTML; }

if (typeof module !== "undefined" && module.exports) {
  module.exports = { RFQ_TEMPLATE_HTML, rfqTemplateHtml };
}
