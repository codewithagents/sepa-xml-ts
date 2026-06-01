/**
 * Shared XML-emission helpers for the pain.001 and pain.008 writers.
 *
 * All helpers push to a caller-supplied string array. The array is later
 * joined with '\n' by the writer to form the final XML document.
 *
 * Indentation conventions used across both writers:
 *   2 spaces  - Document root element (CstmrCdtTrfInitn / CstmrDrctDbtInitn)
 *   4 spaces  - GrpHdr, PmtInf
 *   6 spaces  - PmtInf children, GrpHdr children
 *   8 spaces  - PmtTpInf children, transaction-level children (CdtTrfTxInf / DrctDbtTxInf)
 *  10 spaces  - nested inside 8-space elements
 *  12 spaces  - nested inside 10-space elements
 *
 * Internal module: not exported from index.ts.
 */

import { escapeXml } from '../model/charset.js'
import { formatAmountForXml, sumMoney } from '../model/amount.js'
import type { Money, PostalAddress, UltimateParty } from '../model/schema.js'

/**
 * Escape a value for use in XML text content.
 * Thin wrapper around escapeXml; kept here so writer files
 * import only from xml-emit.ts.
 */
export function xe(value: string): string {
  return escapeXml(value)
}

/** Compute total transaction count and control sum from an array of Money values. */
export function computeTotals(amounts: readonly Money[]): { txCount: number; ctrlSum: bigint } {
  return { txCount: amounts.length, ctrlSum: sumMoney(amounts) }
}

/**
 * Emit the GrpHdr block.
 * Produces 9 lines at fixed 4/6/8-space indentation (same in both writers).
 */
export function emitGrpHdr(
  lines: string[],
  messageId: string,
  createdAt: string,
  txCount: number,
  ctrlSum: bigint,
  initiatingParty: string
): void {
  lines.push(`    <GrpHdr>`)
  lines.push(`      <MsgId>${xe(messageId)}</MsgId>`)
  lines.push(`      <CreDtTm>${xe(createdAt)}</CreDtTm>`)
  lines.push(`      <NbOfTxs>${txCount}</NbOfTxs>`)
  lines.push(
    `      <CtrlSum>${formatAmountForXml({ currencyCode: 'EUR', minorUnits: ctrlSum })}</CtrlSum>`
  )
  lines.push(`      <InitgPty>`)
  lines.push(`        <Nm>${xe(initiatingParty)}</Nm>`)
  lines.push(`      </InitgPty>`)
  lines.push(`    </GrpHdr>`)
}

/**
 * Emit the GrpHdr block without CtrlSum.
 *
 * Used for the German DK SDD variant (pain.008.003.02), where CtrlSum is
 * optional in GroupHeaderSDD and the reference sample omits it.
 * Produces 8 lines at fixed 4/6/8-space indentation.
 */
export function emitGrpHdrNoCtrlSum(
  lines: string[],
  messageId: string,
  createdAt: string,
  txCount: number,
  initiatingParty: string
): void {
  lines.push(`    <GrpHdr>`)
  lines.push(`      <MsgId>${xe(messageId)}</MsgId>`)
  lines.push(`      <CreDtTm>${xe(createdAt)}</CreDtTm>`)
  lines.push(`      <NbOfTxs>${txCount}</NbOfTxs>`)
  lines.push(`      <InitgPty>`)
  lines.push(`        <Nm>${xe(initiatingParty)}</Nm>`)
  lines.push(`      </InitgPty>`)
  lines.push(`    </GrpHdr>`)
}

/**
 * Emit the SvcLvl/Cd=SEPA block inside a PmtTpInf element (8-space indent).
 * Both writers use this identically.
 */
export function emitSvcLvl(lines: string[]): void {
  lines.push(`        <SvcLvl>`)
  lines.push(`          <Cd>SEPA</Cd>`)
  lines.push(`        </SvcLvl>`)
}

/**
 * Emit a PstlAdr element for a party block, using the PostalAddress24 element
 * order mandated by the XSD (StrtNm, BldgNb, PstCd, TwnNm, CtrySubDvsn, Ctry, AdrLine).
 *
 * Only elements present in the model are emitted. When address is undefined,
 * nothing is emitted and output is byte-identical to before.
 *
 * @param indent  - leading spaces for the PstlAdr tag (one level deeper than the party tag)
 * @param address - optional PostalAddress from the model; nothing emitted when absent
 */
export function emitPstlAdr(lines: string[], indent: string, address: PostalAddress | undefined): void {
  if (address === undefined) {
    return
  }
  lines.push(`${indent}<PstlAdr>`)
  const inner = `${indent}  `
  // XSD PostalAddress24 element order (we emit only the subset we model):
  // Dept, SubDept, StrtNm, BldgNb, BldgNm, Flr, PstBx, Room, PstCd, TwnNm,
  // TwnLctnNm, DstrctNm, CtrySubDvsn, Ctry, AdrLine
  if (address.streetName !== undefined) {
    lines.push(`${inner}<StrtNm>${xe(address.streetName)}</StrtNm>`)
  }
  if (address.buildingNumber !== undefined) {
    lines.push(`${inner}<BldgNb>${xe(address.buildingNumber)}</BldgNb>`)
  }
  if (address.postCode !== undefined) {
    lines.push(`${inner}<PstCd>${xe(address.postCode)}</PstCd>`)
  }
  if (address.townName !== undefined) {
    lines.push(`${inner}<TwnNm>${xe(address.townName)}</TwnNm>`)
  }
  if (address.countrySubDivision !== undefined) {
    lines.push(`${inner}<CtrySubDvsn>${xe(address.countrySubDivision)}</CtrySubDvsn>`)
  }
  if (address.country !== undefined) {
    lines.push(`${inner}<Ctry>${xe(address.country)}</Ctry>`)
  }
  if (address.addressLines !== undefined) {
    for (const line of address.addressLines) {
      lines.push(`${inner}<AdrLine>${xe(line)}</AdrLine>`)
    }
  }
  lines.push(`${indent}</PstlAdr>`)
}

/**
 * Emit a party element with Nm and optional PstlAdr.
 * Used for Dbtr, Cdtr blocks in pain.001.001.09 and pain.008.001.08.
 *
 * PstlAdr follows Nm immediately, per PartyIdentification135 in the XSD.
 *
 * @param indent  - leading spaces for the outer tag (e.g. "      " for 6 spaces)
 * @param tag     - element name, e.g. "Dbtr" or "Cdtr"
 * @param name    - party name (will be XML-escaped)
 * @param address - optional structured postal address
 */
export function emitPartyWithAddress(
  lines: string[],
  indent: string,
  tag: string,
  name: string,
  address: PostalAddress | undefined
): void {
  lines.push(`${indent}<${tag}>`)
  lines.push(`${indent}  <Nm>${xe(name)}</Nm>`)
  emitPstlAdr(lines, `${indent}  `, address)
  lines.push(`${indent}</${tag}>`)
}

/**
 * Emit a party element containing only a Nm child.
 * Used for Dbtr, Cdtr blocks that carry just the name (legacy/DK variants).
 *
 * @param indent - leading spaces for the outer tag (e.g. "      " for 6 spaces)
 * @param tag    - element name, e.g. "Dbtr" or "Cdtr"
 * @param name   - party name (will be XML-escaped)
 */
export function emitNmElement(lines: string[], indent: string, tag: string, name: string): void {
  lines.push(`${indent}<${tag}>`)
  lines.push(`${indent}  <Nm>${xe(name)}</Nm>`)
  lines.push(`${indent}</${tag}>`)
}

/**
 * Emit an account element with an Id/IBAN child.
 * Used for DbtrAcct and CdtrAcct.
 *
 * @param indent - leading spaces for the outer tag
 * @param tag    - element name, e.g. "DbtrAcct" or "CdtrAcct"
 * @param iban   - IBAN string (will be XML-escaped)
 */
export function emitIbanAcct(lines: string[], indent: string, tag: string, iban: string): void {
  lines.push(`${indent}<${tag}>`)
  lines.push(`${indent}  <Id>`)
  lines.push(`${indent}    <IBAN>${xe(iban)}</IBAN>`)
  lines.push(`${indent}  </Id>`)
  lines.push(`${indent}</${tag}>`)
}

/**
 * Emit a FinInstnId wrapper element that is always present (required by XSD),
 * with an optional BICFI child.
 *
 * Used for DbtrAgt (pain.001 PmtInf level), CdtrAgt (pain.008 PmtInf level),
 * CdtrAgt (pain.001 transaction level), and DbtrAgt (pain.008 transaction level).
 *
 * @param indent - leading spaces for the outer agent tag (e.g. "      " for 6 spaces)
 * @param tag    - element name, e.g. "DbtrAgt" or "CdtrAgt"
 * @param bic    - optional BIC string (will be XML-escaped if present)
 */
export function emitAlwaysFinInstnId(
  lines: string[],
  indent: string,
  tag: string,
  bic?: string
): void {
  const inner = `${indent}  `
  const bicIndent = `${indent}    `
  lines.push(`${indent}<${tag}>`)
  lines.push(`${inner}<FinInstnId>`)
  if (bic !== undefined) {
    lines.push(`${bicIndent}<BICFI>${xe(bic)}</BICFI>`)
  }
  lines.push(`${inner}</FinInstnId>`)
  lines.push(`${indent}</${tag}>`)
}

/**
 * Emit the opening lines of a PmtInf element through CtrlSum.
 * Both writers share this block; the PmtMtd value ("TRF" or "DD") differs.
 *
 * XSD ordering for PmtInf children (pain.001.001.09 and pain.008.001.08):
 *   PmtInfId, PmtMtd, BtchBookg (optional), NbOfTxs, CtrlSum, PmtTpInf ...
 *
 * BtchBookg is inserted after PmtMtd and before NbOfTxs when batchBooking is
 * provided. When undefined, BtchBookg is not emitted (default behaviour).
 *
 * Callers emit PmtTpInf (and its contents) immediately after.
 */
export function emitPmtInfHeader(
  lines: string[],
  id: string,
  pmtMtd: string,
  nbOfTxs: number,
  ctrlSum: bigint,
  batchBooking?: boolean
): void {
  lines.push(`    <PmtInf>`)
  lines.push(`      <PmtInfId>${xe(id)}</PmtInfId>`)
  lines.push(`      <PmtMtd>${pmtMtd}</PmtMtd>`)
  if (batchBooking !== undefined) {
    lines.push(`      <BtchBookg>${batchBooking ? 'true' : 'false'}</BtchBookg>`)
  }
  lines.push(`      <NbOfTxs>${nbOfTxs}</NbOfTxs>`)
  lines.push(
    `      <CtrlSum>${formatAmountForXml({ currencyCode: 'EUR', minorUnits: ctrlSum })}</CtrlSum>`
  )
}

/**
 * Emit a conditional RmtInf/Ustrd element at 8-space indent.
 * Used in both CdtTrfTxInf (pain.001) and DrctDbtTxInf (pain.008).
 *
 * @param remittanceInfo - optional remittance text; nothing is emitted if undefined
 */
export function emitRmtInf(lines: string[], remittanceInfo: string | undefined): void {
  if (remittanceInfo !== undefined) {
    lines.push(`        <RmtInf>`)
    lines.push(`          <Ustrd>${xe(remittanceInfo)}</Ustrd>`)
    lines.push(`        </RmtInf>`)
  }
}

/**
 * Emit a FinInstnId wrapper element for the ISO pain.001.001.03 variant.
 *
 * The .001.03 XSD uses FinancialInstitutionIdentification7, which has a <BIC>
 * element (not <BICFI>) and all children are optional (minOccurs=0). This means:
 *   - When bic is present: emit <tag><FinInstnId><BIC>...</BIC></FinInstnId></tag>
 *   - When bic is absent and required is true: emit <tag><FinInstnId/></tag>
 *     (empty is XSD-valid because all children are optional)
 *   - When bic is absent and required is false: omit the element entirely
 *
 * @param indent   - leading spaces for the outer agent tag
 * @param tag      - element name, e.g. "DbtrAgt" or "CdtrAgt"
 * @param bic      - optional BIC string (will be XML-escaped if present)
 * @param required - when true and bic is absent, emit an empty FinInstnId element
 */
export function emitIso03FinInstnId(
  lines: string[],
  indent: string,
  tag: string,
  bic: string | undefined,
  required: boolean
): void {
  if (bic === undefined && !required) {
    // Optional element with no BIC: omit entirely (e.g. CdtrAgt at tx level)
    return
  }
  const inner = `${indent}  `
  const bicIndent = `${indent}    `
  lines.push(`${indent}<${tag}>`)
  if (bic !== undefined) {
    lines.push(`${inner}<FinInstnId>`)
    lines.push(`${bicIndent}<BIC>${xe(bic)}</BIC>`)
    lines.push(`${inner}</FinInstnId>`)
  } else {
    // No BIC and required: emit empty FinInstnId (all children are optional in FinancialInstitutionIdentification7)
    lines.push(`${inner}<FinInstnId/>`)
  }
  lines.push(`${indent}</${tag}>`)
}

/**
 * Emit an ultimate party element (UltmtDbtr or UltmtCdtr) containing only a Nm child.
 *
 * Used for the name-only first-cut of UltmtDbtr / UltmtCdtr in pain.001.001.09
 * (CdtTrfTxInf) and pain.008.001.08 (DrctDbtTxInf).
 *
 * Nothing is emitted when party is undefined, preserving byte-identical output
 * for documents that do not use ultimate parties.
 *
 * @param indent  - leading spaces for the outer tag (e.g. "        " for 8 spaces)
 * @param tag     - element name, e.g. "UltmtDbtr" or "UltmtCdtr"
 * @param party   - optional UltimateParty model value
 */
export function emitUltimateParty(
  lines: string[],
  indent: string,
  tag: string,
  party: UltimateParty | undefined
): void {
  if (party === undefined) {
    return
  }
  lines.push(`${indent}<${tag}>`)
  lines.push(`${indent}  <Nm>${xe(party.name)}</Nm>`)
  lines.push(`${indent}</${tag}>`)
}

/**
 * Emit a FinInstnId wrapper element for the DK pain.001.003.03 variant.
 *
 * The DK XSD uses:
 * - BranchAndFinancialInstitutionIdentificationSEPA3 for DbtrAgt (required, allows BIC or Othr/NOTPROVIDED)
 * - BranchAndFinancialInstitutionIdentificationSEPA1 for CdtrAgt tx-level (optional, requires BIC when present)
 *
 * Key difference from pain.001.001.09: element name is "BIC", not "BICFI".
 *
 * When bic is undefined and required is true, emits Othr/Id=NOTPROVIDED (the only allowed fallback
 * in the DK XSD for DbtrAgt). When bic is undefined and required is false (CdtrAgt), the whole
 * element is omitted by the caller.
 *
 * @param indent   - leading spaces for the outer agent tag (e.g. "      " for 6 spaces)
 * @param tag      - element name, e.g. "DbtrAgt" or "CdtrAgt"
 * @param bic      - optional BIC string (will be XML-escaped if present)
 * @param required - when true and bic is absent, emit Othr/Id=NOTPROVIDED instead of omitting the element
 */
export function emitDkFinInstnId(
  lines: string[],
  indent: string,
  tag: string,
  bic: string | undefined,
  required: boolean
): void {
  if (bic === undefined && !required) {
    // Optional element with no BIC: omit entirely (e.g. CdtrAgt at tx level)
    return
  }
  const inner = `${indent}  `
  const bicIndent = `${indent}    `
  lines.push(`${indent}<${tag}>`)
  lines.push(`${inner}<FinInstnId>`)
  if (bic !== undefined) {
    lines.push(`${bicIndent}<BIC>${xe(bic)}</BIC>`)
  } else {
    // No BIC available: use NOTPROVIDED (the only allowed fallback in FinancialInstitutionIdentificationSEPA3)
    lines.push(`${bicIndent}<Othr>`)
    lines.push(`${bicIndent}  <Id>NOTPROVIDED</Id>`)
    lines.push(`${bicIndent}</Othr>`)
  }
  lines.push(`${inner}</FinInstnId>`)
  lines.push(`${indent}</${tag}>`)
}
