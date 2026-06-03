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
import type {
  Money,
  PostalAddress,
  UltimateParty,
  PartyIdentification,
  GenericIdentification,
  StructuredRemittance,
  ReferredDocument,
  RemittanceAmount,
  ReferenceType,
  Purpose,
  CategoryPurpose,
} from '../model/schema.js'

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
 * Emit the Ctry child, all AdrLine children, then the closing PstlAdr tag.
 *
 * Private helper shared by emitPstlAdr (PostalAddress24) and emitPstlAdrSEPA
 * (PostalAddressSEPA). Both end with the same element sequence: optional Ctry
 * followed by zero-or-more AdrLine elements, then the closing tag.
 * The caller opens the PstlAdr element before calling this.
 *
 * @param indent  - leading spaces used for the PstlAdr tag (not the children)
 * @param address - PostalAddress from the model (caller guarantees it is defined)
 */
function emitCtryAdrLinesClose(lines: string[], indent: string, address: PostalAddress): void {
  const inner = `${indent}  `
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
 * Emit a PstlAdr element for a party block, using the PostalAddress24 element
 * order mandated by the XSD (StrtNm, BldgNb, PstCd, TwnNm, CtrySubDvsn, Ctry, AdrLine).
 *
 * Only elements present in the model are emitted. When address is undefined,
 * nothing is emitted and output is byte-identical to before.
 *
 * @param indent  - leading spaces for the PstlAdr tag (one level deeper than the party tag)
 * @param address - optional PostalAddress from the model; nothing emitted when absent
 */
function emitPstlAdr(lines: string[], indent: string, address: PostalAddress | undefined): void {
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
  emitCtryAdrLinesClose(lines, indent, address)
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
 * Emit a PstlAdr element for the DK SEPA variants (pain.001.003.03 and pain.008.003.02).
 *
 * These variants use PostalAddressSEPA (XSD type name), which supports only:
 *   Ctry   (optional, ISO 3166-1 alpha-2, occurs first in the sequence)
 *   AdrLine (optional, max 2 occurrences)
 *
 * Throws a clear, specific error when the PostalAddress model contains any field
 * not supported by this type (streetName, buildingNumber, postCode, townName,
 * countrySubDivision), or when addressLines has more than 2 entries.
 * This prevents silent data loss. To omit the address entirely, pass undefined.
 *
 * Confirmed against schemas/dk/pain.001.003.03.xsd and schemas/dk/pain.008.003.02.xsd:
 * PostalAddressSEPA sequence: Ctry (minOccurs=0), AdrLine (minOccurs=0, maxOccurs=2).
 *
 * @param lines   - output line array
 * @param indent  - leading spaces for the PstlAdr tag
 * @param address - optional PostalAddress from the model; nothing emitted when absent
 * @param variant - variant name used in error messages
 */
function emitPstlAdrSEPA(
  lines: string[],
  indent: string,
  address: PostalAddress | undefined,
  variant: string
): void {
  if (address === undefined) {
    return
  }

  // Fail loud on fields not supported by PostalAddressSEPA.
  if (address.streetName !== undefined) {
    throw new Error(
      `field 'streetName' is not supported in the ${variant} postal address (PostalAddressSEPA only allows Ctry and AdrLine)`
    )
  }
  if (address.buildingNumber !== undefined) {
    throw new Error(
      `field 'buildingNumber' is not supported in the ${variant} postal address (PostalAddressSEPA only allows Ctry and AdrLine)`
    )
  }
  if (address.postCode !== undefined) {
    throw new Error(
      `field 'postCode' is not supported in the ${variant} postal address (PostalAddressSEPA only allows Ctry and AdrLine)`
    )
  }
  if (address.townName !== undefined) {
    throw new Error(
      `field 'townName' is not supported in the ${variant} postal address (PostalAddressSEPA only allows Ctry and AdrLine)`
    )
  }
  if (address.countrySubDivision !== undefined) {
    throw new Error(
      `field 'countrySubDivision' is not supported in the ${variant} postal address (PostalAddressSEPA only allows Ctry and AdrLine)`
    )
  }
  if (address.addressLines !== undefined && address.addressLines.length > 2) {
    throw new Error(
      `addressLines has ${address.addressLines.length} entries but PostalAddressSEPA in ${variant} allows at most 2 AdrLine elements`
    )
  }

  // PostalAddressSEPA element order: Ctry, AdrLine (same tail as PostalAddress24)
  lines.push(`${indent}<PstlAdr>`)
  emitCtryAdrLinesClose(lines, indent, address)
}

/**
 * Emit a party element with Nm and optional PstlAdr for the DK SEPA variants.
 * Used for Dbtr and Cdtr blocks in pain.001.003.03 and pain.008.003.02.
 *
 * PstlAdr follows Nm immediately (PostalAddressSEPA, per DK XSD).
 * Throws if the address contains fields not supported by PostalAddressSEPA.
 *
 * @param indent  - leading spaces for the outer tag
 * @param tag     - element name, e.g. "Dbtr" or "Cdtr"
 * @param name    - party name (will be XML-escaped)
 * @param address - optional structured postal address
 * @param variant - variant name for error messages
 */
export function emitPartyWithAddressDK(
  lines: string[],
  indent: string,
  tag: string,
  name: string,
  address: PostalAddress | undefined,
  variant: string
): void {
  lines.push(`${indent}<${tag}>`)
  lines.push(`${indent}  <Nm>${xe(name)}</Nm>`)
  emitPstlAdrSEPA(lines, `${indent}  `, address, variant)
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
 * Emit the inner Cd or Prtry line of a CdOrPrtry choice at the given indent.
 * A plain string is the Cd path; an object { proprietary } is the Prtry path.
 * Used by referred-document type (ReferredDocumentType3Choice) and creditor
 * reference type (CreditorReferenceType1Choice).
 *
 * @param indent - leading spaces for the Cd/Prtry line
 * @param value  - the Cd string or the { proprietary } object
 */
function emitCdOrPrtryAt(
  lines: string[],
  indent: string,
  value: string | { proprietary: string }
): void {
  if (typeof value === 'string') {
    lines.push(`${indent}<Cd>${xe(value)}</Cd>`)
  } else {
    lines.push(`${indent}<Prtry>${xe(value.proprietary)}</Prtry>`)
  }
}

/**
 * Emit an EUR amount element (ActiveOrHistoricCurrencyAndAmount) with Ccy="EUR".
 * Uses the same 2-decimal formatting as the transaction InstdAmt. These amounts
 * are informational (RfrdDocAmt sub-amounts) and never affect CtrlSum.
 *
 * @param indent - leading spaces for the element
 * @param tag    - element name, e.g. "DuePyblAmt" or "RmtdAmt"
 * @param money  - the EUR Money value
 */
function emitAmtEur(lines: string[], indent: string, tag: string, money: Money): void {
  lines.push(`${indent}<${tag} Ccy="EUR">${formatAmountForXml(money)}</${tag}>`)
}

/**
 * Emit one RfrdDocInf element (ReferredDocumentInformation7) at 12-space indent.
 *
 * XSD element order: Tp (ReferredDocumentType4: CdOrPrtry then Issr), Nb, RltdDt.
 * Only present fields are emitted; the model guarantees at least one is set.
 *
 * @param doc - a referred document model value
 */
function emitRfrdDocInf(lines: string[], doc: ReferredDocument): void {
  lines.push(`            <RfrdDocInf>`)
  if (doc.type !== undefined) {
    lines.push(`              <Tp>`)
    lines.push(`                <CdOrPrtry>`)
    emitCdOrPrtryAt(lines, '                  ', doc.type)
    lines.push(`                </CdOrPrtry>`)
    lines.push(`              </Tp>`)
  }
  if (doc.number !== undefined) {
    lines.push(`              <Nb>${xe(doc.number)}</Nb>`)
  }
  if (doc.relatedDate !== undefined) {
    lines.push(`              <RltdDt>${xe(doc.relatedDate)}</RltdDt>`)
  }
  lines.push(`            </RfrdDocInf>`)
}

/**
 * Emit the RfrdDocAmt element (RemittanceAmount2) at 12-space indent.
 *
 * XSD element order for the fields we model: DuePyblAmt, CdtNoteAmt, RmtdAmt.
 * Only present amounts are emitted; the model guarantees at least one is set.
 *
 * @param amount - the referred-document amount model value
 */
function emitRfrdDocAmt(lines: string[], amount: RemittanceAmount): void {
  lines.push(`            <RfrdDocAmt>`)
  if (amount.duePayableAmount !== undefined) {
    emitAmtEur(lines, '              ', 'DuePyblAmt', amount.duePayableAmount)
  }
  if (amount.creditNoteAmount !== undefined) {
    emitAmtEur(lines, '              ', 'CdtNoteAmt', amount.creditNoteAmount)
  }
  if (amount.remittedAmount !== undefined) {
    emitAmtEur(lines, '              ', 'RmtdAmt', amount.remittedAmount)
  }
  lines.push(`            </RfrdDocAmt>`)
}

/**
 * Emit the CdtrRefInf element (CreditorReferenceInformation2) at 12-space indent.
 *
 * XSD element order: Tp (CreditorReferenceType2: CdOrPrtry then Issr) before Ref.
 * The reference type defaults to "SCOR" when absent; issuer is emitted only when
 * present. Called only when creditorReference is set, so Ref is always emitted.
 *
 * @param sr - the structured remittance model value (creditorReference is defined)
 */
function emitCdtrRefInf(lines: string[], sr: StructuredRemittance): void {
  const refType: ReferenceType = sr.referenceType ?? 'SCOR'
  lines.push(`            <CdtrRefInf>`)
  lines.push(`              <Tp>`)
  lines.push(`                <CdOrPrtry>`)
  emitCdOrPrtryAt(lines, '                  ', refType)
  lines.push(`                </CdOrPrtry>`)
  if (sr.issuer !== undefined) {
    lines.push(`                <Issr>${xe(sr.issuer)}</Issr>`)
  }
  lines.push(`              </Tp>`)
  lines.push(`              <Ref>${xe(sr.creditorReference ?? '')}</Ref>`)
  lines.push(`            </CdtrRefInf>`)
}

/**
 * Emit a conditional RmtInf/Strd element at 8-space indent.
 * Used in CdtTrfTxInf (pain.001.001.09) and DrctDbtTxInf (pain.008.001.08).
 *
 * XSD element ordering (confirmed against both XSDs):
 *   RemittanceInformation16: Ustrd before Strd
 *   StructuredRemittanceInformation16: RfrdDocInf (0..n), RfrdDocAmt (0..1), CdtrRefInf (0..1)
 *   ReferredDocumentInformation7: Tp, Nb, RltdDt
 *   RemittanceAmount2: DuePyblAmt, ..., CdtNoteAmt, ..., RmtdAmt
 *   CreditorReferenceInformation2: Tp (CdOrPrtry then Issr) before Ref
 *   CreditorReferenceType1Choice: Cd or Prtry
 *
 * The CdtrRefInf-only path (referredDocuments and referredDocumentAmount both
 * absent) emits byte-identical output to before this gained RfrdDocInf/RfrdDocAmt.
 *
 * @param structuredRemittance - optional structured remittance; nothing emitted if undefined
 */
export function emitStructuredRmtInf(
  lines: string[],
  structuredRemittance: StructuredRemittance | undefined
): void {
  if (structuredRemittance === undefined) {
    return
  }
  lines.push(`        <RmtInf>`)
  lines.push(`          <Strd>`)
  if (structuredRemittance.referredDocuments !== undefined) {
    for (const doc of structuredRemittance.referredDocuments) {
      emitRfrdDocInf(lines, doc)
    }
  }
  if (structuredRemittance.referredDocumentAmount !== undefined) {
    emitRfrdDocAmt(lines, structuredRemittance.referredDocumentAmount)
  }
  if (structuredRemittance.creditorReference !== undefined) {
    emitCdtrRefInf(lines, structuredRemittance)
  }
  lines.push(`          </Strd>`)
  lines.push(`        </RmtInf>`)
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
 * Emit a generic identifier (Othr) inside an OrgId or PrvtId block.
 *
 * GenericOrganisationIdentification1 / GenericPersonIdentification1 share the
 * same element order: Id, SchmeNm (Cd), Issr. Only present fields are emitted.
 * schemeName is written as SchmeNm/Cd (proprietary Prtry is not modelled).
 *
 * @param indent - leading spaces for the <Othr> tag
 * @param other  - the generic identifier model value
 */
function emitGenericOther(lines: string[], indent: string, other: GenericIdentification): void {
  const inner = `${indent}  `
  lines.push(`${indent}<Othr>`)
  lines.push(`${inner}<Id>${xe(other.id)}</Id>`)
  if (other.schemeName !== undefined) {
    lines.push(`${inner}<SchmeNm>`)
    lines.push(`${inner}  <Cd>${xe(other.schemeName)}</Cd>`)
    lines.push(`${inner}</SchmeNm>`)
  }
  if (other.issuer !== undefined) {
    lines.push(`${inner}<Issr>${xe(other.issuer)}</Issr>`)
  }
  lines.push(`${indent}</Othr>`)
}

/**
 * Emit an OrgId element (OrganisationIdentification29) at the given indent.
 * Element order: AnyBIC, LEI, Othr.
 *
 * @param indent - leading spaces for the <OrgId> tag
 * @param org    - the OrganisationIdentification model value
 */
function emitOrgId(
  lines: string[],
  indent: string,
  org: PartyIdentification['organisationId'] & object
): void {
  const inner = `${indent}  `
  lines.push(`${indent}<OrgId>`)
  if (org.bic !== undefined) {
    lines.push(`${inner}<AnyBIC>${xe(org.bic)}</AnyBIC>`)
  }
  if (org.lei !== undefined) {
    lines.push(`${inner}<LEI>${xe(org.lei)}</LEI>`)
  }
  if (org.other !== undefined) {
    emitGenericOther(lines, inner, org.other)
  }
  lines.push(`${indent}</OrgId>`)
}

/**
 * Emit a DtAndPlcOfBirth element (DateAndPlaceOfBirth1) at the given indent.
 * Element order: BirthDt, PrvcOfBirth (optional), CityOfBirth, CtryOfBirth.
 *
 * @param indent - leading spaces for the <DtAndPlcOfBirth> tag
 * @param dob    - the DateAndPlaceOfBirth model value
 */
function emitDtAndPlcOfBirth(
  lines: string[],
  indent: string,
  dob: NonNullable<PartyIdentification['privateId']>['dateAndPlaceOfBirth'] & object
): void {
  const inner = `${indent}  `
  lines.push(`${indent}<DtAndPlcOfBirth>`)
  lines.push(`${inner}<BirthDt>${xe(dob.birthDate)}</BirthDt>`)
  if (dob.provinceOfBirth !== undefined) {
    lines.push(`${inner}<PrvcOfBirth>${xe(dob.provinceOfBirth)}</PrvcOfBirth>`)
  }
  lines.push(`${inner}<CityOfBirth>${xe(dob.cityOfBirth)}</CityOfBirth>`)
  lines.push(`${inner}<CtryOfBirth>${xe(dob.countryOfBirth)}</CtryOfBirth>`)
  lines.push(`${indent}</DtAndPlcOfBirth>`)
}

/**
 * Emit a PrvtId element (PersonIdentification13) at the given indent.
 * Element order: DtAndPlcOfBirth (optional), Othr (optional).
 *
 * @param indent - leading spaces for the <PrvtId> tag
 * @param prvt   - the PrivateIdentification model value
 */
function emitPrvtId(
  lines: string[],
  indent: string,
  prvt: NonNullable<PartyIdentification['privateId']>
): void {
  const inner = `${indent}  `
  lines.push(`${indent}<PrvtId>`)
  if (prvt.dateAndPlaceOfBirth !== undefined) {
    emitDtAndPlcOfBirth(lines, inner, prvt.dateAndPlaceOfBirth)
  }
  if (prvt.other !== undefined) {
    emitGenericOther(lines, inner, prvt.other)
  }
  lines.push(`${indent}</PrvtId>`)
}

/**
 * Emit the structured party identification (Id, Party38Choice) for an ultimate
 * party, in the exact XSD element order. Delegates to emitOrgId or emitPrvtId.
 *
 * The model guarantees exactly one of organisationId / privateId is set.
 *
 * @param indent - leading spaces for the <Id> tag
 * @param id     - the PartyIdentification model value
 */
function emitPartyId(lines: string[], indent: string, id: PartyIdentification): void {
  const inner = `${indent}  `
  lines.push(`${indent}<Id>`)
  if (id.organisationId !== undefined) {
    emitOrgId(lines, inner, id.organisationId)
  } else if (id.privateId !== undefined) {
    emitPrvtId(lines, inner, id.privateId)
  }
  lines.push(`${indent}</Id>`)
}

/**
 * Emit an ultimate party element (UltmtDbtr or UltmtCdtr) with a Nm child and an
 * optional structured Id child.
 *
 * Used for UltmtDbtr / UltmtCdtr in pain.001.001.09 (CdtTrfTxInf) and
 * pain.008.001.08 (DrctDbtTxInf). Element order follows PartyIdentification135:
 * Nm then Id.
 *
 * Nothing is emitted when party is undefined, preserving byte-identical output
 * for documents that do not use ultimate parties. When the party has no id, the
 * output is identical to the prior name-only behaviour.
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
  if (party.id !== undefined) {
    emitPartyId(lines, `${indent}  `, party.id)
  }
  lines.push(`${indent}</${tag}>`)
}

/**
 * Emit the inner Cd or Prtry line of a purpose choice (Purpose2Choice /
 * CategoryPurpose1Choice). A plain string is the Cd path; an object { proprietary }
 * is the Prtry path. Exactly one is emitted, matching the XSD choice.
 *
 * @param lines - output buffer
 * @param value - the Cd string or the { proprietary } object
 */
function emitCdOrPrtryLine(lines: string[], value: string | { proprietary: string }): void {
  if (typeof value === 'string') {
    lines.push(`          <Cd>${xe(value)}</Cd>`)
  } else {
    lines.push(`          <Prtry>${xe(value.proprietary)}</Prtry>`)
  }
}

/**
 * Emit a conditional Purp element at 8-space indent (Purpose2Choice: Cd XOR Prtry).
 * Used in both CdtTrfTxInf (pain.001.001.09) and DrctDbtTxInf (pain.008.001.08).
 *
 * XSD positions (confirmed against both XSDs):
 * - pain.001 CreditTransferTransaction34: after InstrForDbtrAgt, before RgltryRptg
 *   (in our writer: after UltmtCdtr, before RmtInf)
 * - pain.008 DirectDebitTransactionInformation23: after InstrForCdtrAgt, before RgltryRptg
 *   (in our writer: after UltmtDbtr, before RmtInf)
 *
 * Cd maps to ExternalPurpose1Code (open string, 1-4 chars); Prtry maps to Max35Text.
 * The Cd output is byte-identical to before this gained the Prtry alternative.
 *
 * @param purpose - optional purpose: a Cd string or a { proprietary } object; nothing emitted when absent
 */
export function emitPurp(lines: string[], purpose: Purpose | undefined): void {
  if (purpose !== undefined) {
    lines.push(`        <Purp>`)
    emitCdOrPrtryLine(lines, purpose)
    lines.push(`        </Purp>`)
  }
}

/**
 * Emit a conditional CtgyPurp element inside a PmtTpInf block (8-space indent).
 * CategoryPurpose1Choice: Cd XOR Prtry. Used in PmtInf of both message types.
 *
 * XSD positions (confirmed against both XSDs):
 * - pain.001 PaymentTypeInformation26: LAST child, after SvcLvl (and optional LclInstrm)
 * - pain.008 PaymentTypeInformation29: LAST child, after SvcLvl, LclInstrm, SeqTp
 *
 * Cd maps to ExternalCategoryPurpose1Code (open string, 1-4 chars); Prtry maps to Max35Text.
 * The Cd output is byte-identical to before this gained the Prtry alternative.
 *
 * @param categoryPurpose - optional category purpose: a Cd string or a { proprietary } object
 */
export function emitCtgyPurp(lines: string[], categoryPurpose: CategoryPurpose | undefined): void {
  if (categoryPurpose !== undefined) {
    lines.push(`        <CtgyPurp>`)
    emitCdOrPrtryLine(lines, categoryPurpose)
    lines.push(`        </CtgyPurp>`)
  }
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

/**
 * Emit the opening lines of a CdtTrfTxInf element through the Amt block.
 * Appears identically in all three pain.001 variant writers (pain.001.001.09,
 * pain.001.001.03, and pain.001.003.03). The caller continues with the
 * variant-specific elements (CdtrAgt, Cdtr, CdtrAcct, RmtInf, etc.).
 *
 * XSD ordering (CreditTransferTransaction block):
 *   CdtTrfTxInf open, PmtId/EndToEndId, Amt/InstdAmt
 *
 * @param endToEndId - the end-to-end identifier (will be XML-escaped)
 * @param amount     - the instructed EUR amount
 */
export function emitCdtTrfTxInfHeader(lines: string[], endToEndId: string, amount: Money): void {
  lines.push(`      <CdtTrfTxInf>`)
  lines.push(`        <PmtId>`)
  lines.push(`          <EndToEndId>${xe(endToEndId)}</EndToEndId>`)
  lines.push(`        </PmtId>`)
  lines.push(`        <Amt>`)
  lines.push(`          <InstdAmt Ccy="EUR">${formatAmountForXml(amount)}</InstdAmt>`)
  lines.push(`        </Amt>`)
}

/**
 * Emit the opening lines of a DrctDbtTxInf element through InstdAmt.
 * Appears identically in both pain.008 variant writers (pain.008.001.08 and
 * pain.008.003.02). The caller continues with DrctDbtTx and the variant-specific
 * mandate, agent, and party elements.
 *
 * XSD ordering (DirectDebitTransactionInformation block):
 *   DrctDbtTxInf open, PmtId/EndToEndId, InstdAmt (no Amt wrapper in pain.008)
 *
 * @param endToEndId - the end-to-end identifier (will be XML-escaped)
 * @param amount     - the instructed EUR amount
 */
export function emitDrctDbtTxInfHeader(lines: string[], endToEndId: string, amount: Money): void {
  lines.push(`      <DrctDbtTxInf>`)
  lines.push(`        <PmtId>`)
  lines.push(`          <EndToEndId>${xe(endToEndId)}</EndToEndId>`)
  lines.push(`        </PmtId>`)
  lines.push(`        <InstdAmt Ccy="EUR">${formatAmountForXml(amount)}</InstdAmt>`)
}

/**
 * Emit the CdtrSchmeId element (SEPA Creditor Identifier) at PmtInf level.
 * Used by both pain.008 variant writers (pain.008.001.08 and pain.008.003.02).
 *
 * XSD structure: CdtrSchmeId/Id/PrvtId/Othr: Id (the creditor id) + SchmeNm/Prtry=SEPA.
 * This is the standard SEPA Creditor Identifier placement in every PmtInf block.
 *
 * @param creditorId - the SEPA Creditor Identifier string (will be XML-escaped)
 */
export function emitCdtrSchmeId(lines: string[], creditorId: string): void {
  lines.push(`      <CdtrSchmeId>`)
  lines.push(`        <Id>`)
  lines.push(`          <PrvtId>`)
  lines.push(`            <Othr>`)
  lines.push(`              <Id>${xe(creditorId)}</Id>`)
  lines.push(`              <SchmeNm>`)
  lines.push(`                <Prtry>SEPA</Prtry>`)
  lines.push(`              </SchmeNm>`)
  lines.push(`            </Othr>`)
  lines.push(`          </PrvtId>`)
  lines.push(`        </Id>`)
  lines.push(`      </CdtrSchmeId>`)
}
