# PMR Metrics Map

What the bi-annual PMR deck reports, where each number comes from in the ATLAS
UDQs, and what ATLAS is missing. Source: `PMR Slides DRAFT.pptx` (FY26 Q3 & Q4,
130 slides), read 25 Nov 2026. The Metrics tab is built from this map, one
section at a time: **WMTR first**, then PLS, then Overview.

**Status key**
- **In Utility** means it's calculated today (Metrics › WMTR › SRF, PMR, Export-Controlled or the Christmas Tree rollup).
- **Can compute** means the UDQ already has the fields, but nothing calculates it yet.
- **Missing in ATLAS** means a field has to be added in ATLAS first.

## Counting rules the deck uses

- **Requests by service** count these statuses: Completed, Ready to Invoice, Cancelled, Cancelled with Costs, Invoiced, plus In Progress for PLS and IR.
- **Spending** = amounts invoiced.
- **Which date puts a request in a period:**
  - WMTR and DTR count by **Delivery Date**.
  - PLS and IR count by **Start Date**.
- **SRF metric denominator** = SRFs delivered in the quarter (FY26: 33 / 45 / 36 / 37).
- **PR metric denominator** = PRs completed in the quarter (6 / 13 / 16 / 18).
- **O1 denominator** = warehouse receipts in the quarter (24 / 90 / 63 / 58), not shipments.
- **Outcomes** are shown per fiscal quarter (Q1–Q4) as % and pass/total, colored green / yellow / red. Thresholds are listed per metric below.
- **Every metric detail slide** has the same exception table: Request ID, Explanation, Mitigation, Relief Status. Some add Due / Submitted dates or a CTR Project Manager column.

## WMTR — SRF (Shipping)

### Summary slides (26–30)

| Slide | Data point | UDQ fields | Status |
|---|---|---|---|
| 26 | Completed SRFs by destination country (this half vs last) | Country of Destination, Delivery Date, Status | In Utility (PMR) |
| 27 | SRFs by requesting org / CTRIC (Amentum, B&V, DTRA, Noblis, Parsons, TTI, V2X) | Requestor Email (domain) | Can compute from email domain. A Requestor Organization field would be cleaner |
| 28 | SRFs by shipping mode (Air, Ocean, Surface, Courier, Hand Carry) | Requested Mode of Transit; Cost List › Mode Of Transportation | In Utility (PMR) |
| 29 | Cost of service by program (count + cost) | CTR Program, Total Cost in USD | In Utility (PMR) |
| 30 | Value of cargo by program | CTR Program, Value of Cargo (USD) | In Utility (PMR) |

### Metrics (slides 31–57)

| ID | Metric | Green / Yellow / Red | UDQ fields | Status |
|---|---|---|---|---|
| Q1 | QC issues found during or after Compliance Review | ≥95% / ≥90% / <90% | Workflow Logs (rejections, Rejected Reason) | In Utility |
| Q2 | Shipment indicator violations (temperature, perishable, shock, orientation) | 100% / ≥98% / <98% | Temperature-Control Requirements, Special Handling Instructions, Inventory › temperature and shelf life (which SRFs qualify) | **Missing in ATLAS**: a violation flag and note |
| S1 | NLT vs actual delivery | ≥95% / ≥90% / <90% | NLT Completion Date, Delivery Date | In Utility |
| S6 | Transportation quote/plan within 1 business day of the completed WMTR (after Compliance Review **and** final weights/dims from the warehouse) | 100% / ≥95% / <95% | Workflow Logs (Compliance Review approved), Last Item Warehouse Act. Date, Request Estimate List (Request Date / Estimate Date) | Probably **Can compute**. Need to confirm the Estimate Date is when the quote went to DTRA |
| C1 | Freight consolidation | — | Consolidation analysis (same destination and dates) | In Utility (consolidated groups). Savings $: **Missing in ATLAS** |
| C2 | Pre-solicited freight rates used (updated quarterly, posted in ATLAS) | ≥95% / ≥90% / <90% | — | **Missing in ATLAS**: "Pre-solicited rate used? (Yes / No / N/A)" |
| C6 | Cost estimate accuracy (final within 10%) | ≥95% / ≥90% / <90% | Workflow Logs › Total Cost on the latest approval vs Total Cost in USD | In Utility |
| R1 | Customs clearance free of VAT, taxes and fees | 100% / ≥99% / <99% | Customs Clearance Act. Date; Cost List › Service Description (duty/VAT lines) | Partly **Can compute** (scan cost lines for duty/VAT). A clean answer needs **Missing in ATLAS**: "Duty/VAT paid? + amount" |
| R2 | Export-controlled materials: handling, marking, accountability | 100% / ≥99% / <99% | Inventory › BIS/DDTC Authorization or Exception, ECCN/USML | Counts by class (600 Series, GOV, ITAR, RPL) per quarter: **Can compute** (Export-Controlled tab has the item list). Violations: manual |
| R3 | HAZMAT identification, marking, handling | 100% / ≥99% / <99% | Inventory › HAZMAT/Dangerous Goods Classification, UN Code | Which SRFs qualify: Can compute. Violations: **Missing in ATLAS** |
| R4 | ESOH compliance (Significant Incident Report CDRL) | 100% / ≥99% / <99% | — | **Missing in ATLAS** (incident flag), or stays manual |
| R5 | Shipping documents attached to the WMTR | 100% / ≥99% / <99% | Attachment List › Type | In Utility (Shipping docs). Count by doc type (AES/MFR, AWB/BOL, CIV, MCT, PKL/IPC, POD, SLI, VAT): **Can compute** |
| R6 | Accurate customs filings (e.g. AES filed after departure) | 100% / — / <100% | ITN / NOEEI Citation, AES attachment Created At, Departure from Origin Act. Date | **Can compute** "AES on file before departure" from the attachment date. An AES Filed Date field would be exact |
| R7 | Packaging per best practice and regulations | 100% / ≥98% / <98% | — | **Missing in ATLAS** (violation flag) |
| M4 | Lost or damaged cargo (Yes/No per quarter) | No = green, Yes = red | — | **Missing in ATLAS**: "Lost/Damaged? + description". Today it's a manual flag in DTRA-Only Import/Export Comments |
| O1 | Warehouse receipt entered in ATLAS within 1 business day | ≥98% / ≥95% / <95% | First/Last Item Warehouse Act. Date | **Missing in ATLAS**: the date/time the receipt was *entered* (and per-package receipts) |
| O2 | Tracking details input (carrier, AWB/BoL) | ≥98% / ≥95% / <95% | Shipping Activity › AWB/BoL, Carrier | In Utility |
| O3 | Status change updated within 1 business day | 100% / ≥95% / <95% | Daily Status History | In Utility |

### Other SRF slides

| Slide | Data point | Status |
|---|---|---|
| 41–47 | Duty/VAT exemption process by country and consignment type (Embassy / End user / Mixed) | Reference text, not computed. A "Consignment type" field would let the Utility group clearances by it |
| 58 | Cost savings: direct shipment from vendor (per WMTR, $ saved) | **Missing in ATLAS**: "Direct from vendor? + savings $". Pickup Location Organization hints at it |
| 59–60 | Challenges and accomplishments (incl. $ saved by negotiation and consolidation) | Narrative. A "Cost savings" sub-list (type, $, note) would cover slides 58–60 |

## WMTR — PR (Procurement)

| ID | Metric / data point | Green / Yellow / Red | UDQ fields | Status |
|---|---|---|---|---|
| — | Completed PRs by program (count + cost), by country | — | CTR Program, Country of Destination, Total Cost in USD | **Can compute** |
| S2 | Purchased within 1 business day of government approval | 100% / ≥95% / <95% | Workflow Logs (DTRA Estimate Review Approved) vs Activity Tracker "PR – PO Issued" Date | **Can compute**. The Procurement tab already reads both dates |
| S3 | Estimate within **10** business days of DTRA Compliance Review approval (changed from 3 by the COR, 10 Sep 2026) | 100% / ≥95% / <95% | Workflow Logs | In Utility, but **still uses 3 days**. Needs the 10-day rule from 10 Sep 2026 |
| C3 | Sourced internationally or from local/regional vendors | 100% / ≥98% / <98% | Inventory › Actual Vendor; Cost List › Vendor Name / Address | **Missing in ATLAS**: vendor country or "local/regional?" flag |
| C5 | Cost estimate accuracy (final within 10%) | ≥95% / ≥90% / <90% | Workflow Logs approval cost vs Total Cost in USD | In Utility |
| — | Mission groupings (CENTCOM support, BOS-I, special projects) | — | Charge Code? | Unclear. Need to know whether Charge Code identifies these |

## WMTR — WS (Warehouse Storage)

| Data point | UDQ fields | Status |
|---|---|---|
| WS requests and cost by program | CTR Program, Total Cost in USD, Status | **Can compute** |
| WMTR cost split SRF / PR / WS by program (Financials slides 106–107) | Total Cost in USD per UDQ | **Can compute** |

## WMTR — PMCT (Transfer of Property)

| Slide | Data point | UDQ fields | Status |
|---|---|---|---|
| 70 | TOPs closed per quarter; pending closeout; upcoming | Status, Workflow Logs (Completed date) | **Can compute** (the Property tab tracks these today) |
| 70 | Per TOP: TOP #, PMCT record, source PR, program, recipient country, closed date, material value | Request Title (TOP # is in the title), Linked Request List, CTR Program, Country of Destination, Inventory › Value(USD) | **Can compute**. TOP # is parsed from the title, so a **TOP Number** field in ATLAS would be safer |
| 71 | Cumulative TOP ledger (status, program, title, requestor, CTR PM, TTI POC, country) | Main fields | **Can compute** |

## Export-Controlled (under WMTR)

R2 above. Chart 39 counts controlled line items by class (600 Series, GOV,
ITAR, RPL) per quarter. EAR99 / NLR are not controlled and are never counted.

## Fields to add in ATLAS (WMTR)

Ordered by how many PMR slides each would automate.

1. **Metric exception list** (one row per issue): Metric, Explanation, Mitigation, Relief Requested / Granted. Every metric detail slide uses this table, and today it lives only in the deck.
2. **Lost / Damaged cargo** — Yes/No + description (M4; also explains the missing delivery date in S1 and the R2 exceptions).
3. **Compliance incident flag** — type (Shipment indicator, HAZMAT, Packaging, ESOH) + note (Q2, R3, R4, R7).
4. **Duty/VAT paid at clearance** — Yes/No + amount (R1).
5. **Pre-solicited rate used** — Yes / No / N/A (C2).
6. **Cost savings list** — type (consolidation, direct from vendor, negotiation), $ saved, note (C1, slide 58, accomplishments).
7. **Warehouse receipt entered-at timestamp** (O1).
8. **AES Filed Date** (R6). The attachment date works as a fallback.
9. **Vendor country / local-regional flag** on PR purchases (C3).
10. **TOP Number** on PMCT (slide 70).
11. **Requestor Organization / CTRIC** (slide 27). The email domain works as a fallback.

Later, for Overview: **CLIN** on cost lines (Services / ODC / Travel) and
**Invoice number / date** (Financials slides 102–112).

## PLS, IR, DTR

In Utility since 2.9.38 (Metrics › PLS and PLS › IR / DTR): S7, S8, C4, M10 (AAR, by tag), S4, S5. M5 hotline isn't in ATLAS. Summary data (participants, languages, cancellations) is still to do.

- **PLS summary data:** by program, destination, service category (slide 12), participants per quarter, status, and cancelled requests with reasons.
- **PLS metrics:**
  - S7 — Simple estimate within 3 business days.
  - S8 — Complex estimate within 5 business days.
  - C4 — final cost within 5% of the approved estimate.
  - 24/7 hotline response within 10 minutes (not in ATLAS).
  - AAR within 20 business days, for $75K+, 4+ requests at one event, an onsite coordinator, or when the COR directs.
- **IR / DTR data:** cost by program, interpreter days, words translated by language, status, cancellations.
- **IR / DTR metrics:**
  - S4 — translations delivered by the requested date.
  - S5 — estimate within 5 business days.

## Overview

In Utility since 2.9.38: requests and cost by service, every metric, by program, by destination. Language and financials are still to do.

- Requests and spending by service and by program, for this half and the last (slides 4–6).
- Requests by destination × program (slide 7).
- Requests by language (slide 8).
- Financials: costs by month, by CLIN, by program, by country; invoiced amounts (slides 98–113).
- Customer satisfaction score (4.8 / 5 from ATLAS evaluations, slide 3). This needs the evaluations UDQ.
