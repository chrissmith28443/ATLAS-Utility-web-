/* =========================================================================
   ATLAS Utility Web — constants.js
   Ported from core/constants.py (desktop v4.4)
   ========================================================================= */

const APP_NAME = "ATLAS Utility";
const APP_VERSION = "Web 2.5.62";

/* Signers (Printed Name dropdown) */
const SIGNERS = [
  { name: "Chris M. Smith", title: "Transportation Coordinator" },
  { name: "Steffanie Cruz", title: "Transportation Coordinator" },
  { name: "Toby Hurdle", title: "Transportation Coordinator" },
  { name: "Lee Tilman", title: "Global Materials Transportation Manager" },
];

const PURPOSE_CHOICES = ["Donation", "Return After Repair", "Return For Repair", "Other"];
const MODE_CHOICES = ["Air", "Ocean", "Ground"];

/* Currency choices for the Commercial Invoice (was USD-only). Codes are ISO
   4217; the first entry is the default. Values on the CI are plain numbers, so
   the selected code is what labels the "Total Value" line and the continuation
   subtotal. */
const CI_CURRENCIES = [
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "CNY", name: "Chinese Yuan" },
  { code: "SEK", name: "Swedish Krona" },
  { code: "NOK", name: "Norwegian Krone" },
  { code: "DKK", name: "Danish Krone" },
  { code: "SGD", name: "Singapore Dollar" },
];

/* Default contract number used on the CI (was hardcoded in the desktop template;
   now editable in the CI form, prefilled from the UDQ "Contract #" when present). */
const DEFAULT_CONTRACT_NO = "HDTRA125D0002";

/* SLI Address Book (Freight Location / Forwarding Agent) — used by the SLI tool */
const SLI_LOCATIONS = {
  "Sovana Global Logistics": "23480 Rock Haven Way\nSuite 140\nSterling, VA 20166",
  "Epona Logistics": "44901 Falcon Place\nSuite 108\nDulles, VA 20166",
  "Lynden Logistics": "18000 International Blvd\nSuite 700\nSeattle, WA 98188",
  "APL/CEVA Government Logistics": "1515 N Courthouse Rd.\nSte 700\nArlington, VA 22201-2909",
  "ICAT Logistics, Inc.": "410 N. Freeport Parkway\nSuite 100\nCoppell, TX 75019",
  "MEBS Global Reach, LLC": "14900 Bogle Drive\nSuite 105\nChantilly, VA 20151",
  "ARC": "816 A1A N.\nSuite 101\nPonte Vedra Beach FL 32082",
  "ALARA Logistics, LLC": "9245 Kenswick Drive\nSuite 900\nHumble, TX 77338",
  "AMI Expeditionary Healthcare": "12030 Sunrise Valley Dr.\nSuite 400\nReston, VA",
  "Aegis Trade Solutions": "230-59 Intl. Airport Center Blvd\nSuite 275\nJamaica, NY 11413",
  "All Points, LLC": "4815 Bradford Drive\nHuntsville, AL 35805",
  "Connexi": "1275 New Jersey Avenue SE\nSuite 200\nWashington, DC 20003",
};

/* US state abbreviation -> full name (used by SLI later) */
const US_STATE_FULL = {
  AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas", CA:"California",
  CO:"Colorado", CT:"Connecticut", DE:"Delaware", DC:"District of Columbia",
  FL:"Florida", GA:"Georgia", HI:"Hawaii", ID:"Idaho", IL:"Illinois",
  IN:"Indiana", IA:"Iowa", KS:"Kansas", KY:"Kentucky", LA:"Louisiana",
  ME:"Maine", MD:"Maryland", MA:"Massachusetts", MI:"Michigan", MN:"Minnesota",
  MS:"Mississippi", MO:"Missouri", MT:"Montana", NE:"Nebraska", NV:"Nevada",
  NH:"New Hampshire", NJ:"New Jersey", NM:"New Mexico", NY:"New York",
  NC:"North Carolina", ND:"North Dakota", OH:"Ohio", OK:"Oklahoma",
  OR:"Oregon", PA:"Pennsylvania", RI:"Rhode Island", SC:"South Carolina",
  SD:"South Dakota", TN:"Tennessee", TX:"Texas", UT:"Utah", VT:"Vermont",
  VA:"Virginia", WA:"Washington", WV:"West Virginia", WI:"Wisconsin", WY:"Wyoming",
};

const US_COO = ["US","USA","U.S.","U.S.A.","UNITED STATES","UNITED STATES OF AMERICA"];

/* Fixed CI text */
const CI_PREPARED_BY =
  "Prepared by TechTrans International (TTI), Houston, TX, on behalf of the Defense Threat Reduction Agency (DTRA).";
const CI_DECLARATION =
  "VALUE IS DECLARED FOR CUSTOMS PURPOSES ONLY; NO COMMERCIAL TRANSACTION OCCURRED.";
const CI_REMARKS_BOILERPLATE =
  "These items are controlled by the U.S. government and authorized for export only to the country of ultimate destination for " +
  "use by the ultimate consignee or end-user(s) herein identified. They may not be resold, transferred, or otherwise disposed of, " +
  "to any other country or to any person other than the authorized ultimate consignee or end-user(s), either in their original form " +
  "or after being incorporated into other items, without first obtaining approval from the U.S. government or as otherwise " +
  "authorized by U.S. law and regulations.";

/* Fixed Shipper / USPPI block used on EXPORT commercial invoices.
   DTRA always serves as the Exporter of Record on exports, so the UDQ origin
   party is replaced by this fixed block regardless of what ATLAS shows as origin.
   Ported from desktop templates/ci_document_export.html, which hardcoded it. */
const CI_USPPI_DTRA = {
  contact: "Michael Skidan",
  phone: "+1-571-616-5311",
  email: "michael.skidan.civ@mail.mil",
  tax_id: "52170069100",
  addr_lines: [
    "Defense Threat Reduction Agency",
    "8725 John J. Kingman Rd",
    "Ft. Belvoir, VA 22060",
  ],
  country: "United States of America",
};

/* Node test support (ignored by the browser) */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SIGNERS, PURPOSE_CHOICES, MODE_CHOICES, CI_CURRENCIES, SLI_LOCATIONS, US_STATE_FULL,
    US_COO, DEFAULT_CONTRACT_NO, CI_PREPARED_BY, CI_DECLARATION, CI_REMARKS_BOILERPLATE,
    CI_USPPI_DTRA,
  };
}
