/**
 * Parser for SEPA XML documents.
 *
 * Write targets: pain.001.001.09, pain.001.003.03, pain.008.001.08, pain.008.003.02.
 * Read-only (coexistence) support: pain.001.001.03 and pain.008.001.02.
 *
 * Auto-detects the message type from the xmlns attribute and returns a
 * discriminated union:
 *   { ok: true; type: "pain.001"; data: CreditTransferDocument }
 *   | { ok: true; type: "pain.008"; data: DirectDebitDocument }
 *   | { ok: false; error: string }
 *
 * The type strings are version-agnostic. An optional version field carries
 * the detected schema version (e.g. "pain.001.001.03").
 *
 * Uses fast-xml-parser for lightweight, correct XML parsing.
 */

import { XMLParser } from 'fast-xml-parser'
import {
  CreditTransferDocumentSchema,
  type CreditTransferDocument,
  type AccountParty,
  type Transfer,
  type PaymentBatch,
  type Money,
  type PostalAddress,
  type UltimateParty,
  type StructuredRemittance,
} from '../model/schema.js'
import {
  DirectDebitDocumentSchema,
  type DirectDebitDocument,
  type DirectDebitBatch,
  type Collection,
  type Creditor,
  type Mandate,
  type MandateAmendment,
  type SequenceType,
  type LocalInstrument,
} from '../model/pain008.js'

// ---------------------------------------------------------------------------
// ParseResult discriminated union
// ---------------------------------------------------------------------------

export type ParseSuccess001 = {
  ok: true
  type: 'pain.001'
  /** Detected schema version, e.g. "pain.001.001.09" or "pain.001.001.03". */
  version?: string
  data: CreditTransferDocument
}
export type ParseSuccess008 = {
  ok: true
  type: 'pain.008'
  /** Detected schema version, e.g. "pain.008.001.08" or "pain.008.001.02". */
  version?: string
  data: DirectDebitDocument
}
export type ParseFailure = { ok: false; error: string }
export type ParseResult = ParseSuccess001 | ParseSuccess008 | ParseFailure

/**
 * @deprecated Use ParseSuccess001 or ParseSuccess008 for the new discriminated union.
 * Kept for backwards compatibility of the ok:true branch shape.
 */
export type ParseSuccess = ParseSuccess001

// ---------------------------------------------------------------------------
// XML parser configuration
// ---------------------------------------------------------------------------

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Always wrap repeated elements as arrays
  isArray: (tagName) =>
    tagName === 'PmtInf' || tagName === 'CdtTrfTxInf' || tagName === 'DrctDbtTxInf',
  // Preserve string values (don't auto-convert numbers/booleans)
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
})

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

/** Modern write target for credit transfer. */
const NS_PAIN001_09 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09'
/** Legacy read-only credit transfer (coexistence). */
const NS_PAIN001_03 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03'
/** German DK national variant (write target and read support). */
const NS_PAIN001_003_03 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.003.03'
/** Modern write target for direct debit. */
const NS_PAIN008_08 = 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.08'
/** Legacy read-only direct debit (coexistence). */
const NS_PAIN008_02 = 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.02'
/** German DK national variant (write target and read support). */
const NS_PAIN008_003_02 = 'urn:iso:std:iso:20022:tech:xsd:pain.008.003.02'

// ---------------------------------------------------------------------------
// Shared internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a decimal string from XML (e.g. "123.45") into a Money value.
 * The XML always has exactly 2 decimal places from our writers.
 * Accepts values with fewer decimals for robustness.
 */
function parseMoneyString(amountStr: string, ccy: string): Money | null {
  if (ccy !== 'EUR') {
    return null
  }
  const trimmed = amountStr.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null
  }
  const parts = trimmed.split('.')
  const wholePart = parts[0] ?? '0'
  const fracPart = (parts[1] ?? '0').padEnd(2, '0')
  const minorUnits = BigInt(wholePart) * 100n + BigInt(fracPart)
  return { currencyCode: 'EUR', minorUnits }
}

/** Safely get a string value from a parsed object, or null. */
function str(val: unknown): string | null {
  if (typeof val === 'string') return val
  if (typeof val === 'number') return String(val)
  return null
}

/** Safely get a nested value by path, returning null if any step is missing. */
function nav(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj
  for (const key of keys) {
    if (cur === null || cur === undefined || typeof cur !== 'object') {
      return null
    }
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

// ---------------------------------------------------------------------------
// PostalAddress extractor
// ---------------------------------------------------------------------------

/**
 * Extract a PostalAddress from a PstlAdr element, if present.
 * Returns undefined when the element is absent or empty (no known fields).
 * Never returns an empty object, preserving round-trip deep-equality.
 */
function extractPstlAdr(partyEl: unknown): PostalAddress | undefined {
  const pstlAdrEl = nav(partyEl, 'PstlAdr')
  if (pstlAdrEl === null || pstlAdrEl === undefined) {
    return undefined
  }

  const streetName = str(nav(pstlAdrEl, 'StrtNm')) ?? undefined
  const buildingNumber = str(nav(pstlAdrEl, 'BldgNb')) ?? undefined
  const postCode = str(nav(pstlAdrEl, 'PstCd')) ?? undefined
  const townName = str(nav(pstlAdrEl, 'TwnNm')) ?? undefined
  const countrySubDivision = str(nav(pstlAdrEl, 'CtrySubDvsn')) ?? undefined
  const country = str(nav(pstlAdrEl, 'Ctry')) ?? undefined

  // AdrLine can be a single string (when only one line) or an array
  let addressLines: string[] | undefined
  const rawAdrLine = nav(pstlAdrEl, 'AdrLine')
  if (Array.isArray(rawAdrLine)) {
    const lines = rawAdrLine.map((l: unknown) => str(l)).filter((l): l is string => l !== null && l !== '')
    if (lines.length > 0) {
      addressLines = lines
    }
  } else {
    const single = str(rawAdrLine)
    if (single !== null && single !== '') {
      addressLines = [single]
    }
  }

  // If no field was populated, return undefined (no empty object)
  if (
    streetName === undefined &&
    buildingNumber === undefined &&
    postCode === undefined &&
    townName === undefined &&
    countrySubDivision === undefined &&
    country === undefined &&
    addressLines === undefined
  ) {
    return undefined
  }

  const addr: PostalAddress = {}
  if (streetName !== undefined) addr.streetName = streetName
  if (buildingNumber !== undefined) addr.buildingNumber = buildingNumber
  if (postCode !== undefined) addr.postCode = postCode
  if (townName !== undefined) addr.townName = townName
  if (countrySubDivision !== undefined) addr.countrySubDivision = countrySubDivision
  if (country !== undefined) addr.country = country
  if (addressLines !== undefined) addr.addressLines = addressLines
  return addr
}

// ---------------------------------------------------------------------------
// UltimateParty extractor
// ---------------------------------------------------------------------------

/**
 * Extract an UltimateParty from an UltmtDbtr or UltmtCdtr element, if present.
 * Returns undefined when the element is absent or has no Nm child.
 * Never returns an empty object, preserving round-trip deep-equality.
 *
 * @param txEl - the transaction element (CdtTrfTxInf or DrctDbtTxInf)
 * @param tag  - the element name to extract ("UltmtDbtr" or "UltmtCdtr")
 */
function extractUltimateParty(txEl: unknown, tag: string): UltimateParty | undefined {
  const el = nav(txEl, tag)
  if (el === null || el === undefined) {
    return undefined
  }
  const name = str(nav(el, 'Nm'))
  if (name === null || name === '') {
    return undefined
  }
  return { name }
}

// ---------------------------------------------------------------------------
// StructuredRemittance extractor
// ---------------------------------------------------------------------------

/**
 * Extract structured remittance information from a transaction element.
 *
 * Reads RmtInf/Strd/CdtrRefInf:
 *   creditorReference <- Ref
 *   referenceType     <- Tp/CdOrPrtry/Cd
 *   issuer            <- Tp/Issr
 *
 * Returns undefined when absent so round-trip deep-equal holds for documents
 * without structured remittance. The Ustrd path is handled separately.
 *
 * @param txEl - the transaction element (CdtTrfTxInf or DrctDbtTxInf)
 */
function extractStructuredRemittance(txEl: unknown): StructuredRemittance | undefined {
  const cdtrRefInfEl = nav(txEl, 'RmtInf', 'Strd', 'CdtrRefInf')
  if (cdtrRefInfEl === null || cdtrRefInfEl === undefined) {
    return undefined
  }

  const creditorReference = str(nav(cdtrRefInfEl, 'Ref'))
  if (creditorReference === null || creditorReference === '') {
    return undefined
  }

  // Tp/CdOrPrtry/Cd is the reference type code (e.g. "SCOR")
  const referenceType = str(nav(cdtrRefInfEl, 'Tp', 'CdOrPrtry', 'Cd')) ?? undefined
  // Tp/Issr is the issuer (optional)
  const issuer = str(nav(cdtrRefInfEl, 'Tp', 'Issr')) ?? undefined

  const result: StructuredRemittance = { creditorReference }
  // Cd is the DocumentType3Code enum. We cast the raw string here; if the XML
  // carried an out-of-enum value, post-parse model validation rejects it rather
  // than silently accepting an invalid reference type.
  if (referenceType !== undefined) {
    result.referenceType = referenceType as StructuredRemittance['referenceType']
  }
  if (issuer !== undefined) result.issuer = issuer
  return result
}

// ---------------------------------------------------------------------------
// pain.001 extractor functions
// ---------------------------------------------------------------------------

function extractAccountParty(
  partyEl: unknown,
  acctEl: unknown,
  agtEl: unknown
): AccountParty | null {
  const name = str(nav(partyEl, 'Nm'))
  if (!name) return null

  const iban = str(nav(acctEl, 'Id', 'IBAN'))
  if (!iban) return null

  // Try BICFI (pain.001.001.09 / pain.008.001.08) then fall back to BIC (pain.001.001.03 / .02).
  const bic =
    str(nav(agtEl, 'FinInstnId', 'BICFI')) ?? str(nav(agtEl, 'FinInstnId', 'BIC')) ?? undefined

  const address = extractPstlAdr(partyEl)

  return { name, iban, ...(bic !== undefined ? { bic } : {}), ...(address !== undefined ? { address } : {}) }
}

function extractTransfer(txEl: unknown): Transfer | null {
  if (!txEl || typeof txEl !== 'object') return null

  const endToEndId = str(nav(txEl, 'PmtId', 'EndToEndId'))
  if (!endToEndId) return null

  // Amount: <Amt><InstdAmt Ccy="EUR">123.45</InstdAmt></Amt>
  const instdAmt = nav(txEl, 'Amt', 'InstdAmt')
  let amountStr: string | null = null
  let ccy = 'EUR'
  if (typeof instdAmt === 'object' && instdAmt !== null) {
    const amtObj = instdAmt as Record<string, unknown>
    amountStr = str(amtObj['#text'])
    const rawCcy = amtObj['@_Ccy']
    ccy = typeof rawCcy === 'string' ? rawCcy : 'EUR'
  } else {
    amountStr = str(instdAmt)
  }
  if (!amountStr) return null

  const amount = parseMoneyString(amountStr, ccy)
  if (!amount) return null

  // Creditor: Cdtr + CdtrAcct + CdtrAgt (optional)
  const cdtrEl = nav(txEl, 'Cdtr')
  const cdtrAcctEl = nav(txEl, 'CdtrAcct')
  const cdtrAgtEl = nav(txEl, 'CdtrAgt')
  const creditor = extractAccountParty(cdtrEl, cdtrAcctEl, cdtrAgtEl)
  if (!creditor) return null

  // Optional remittanceInfo. Treat empty strings as absent; some older libraries
  // (e.g. sepa / kewisch.js) emit <RmtInf><Ustrd/></RmtInf> when no value is set.
  const ustrdRaw = str(nav(txEl, 'RmtInf', 'Ustrd'))
  const remittanceInfo = ustrdRaw !== null && ustrdRaw !== '' ? ustrdRaw : undefined

  // Optional structured remittance (RmtInf/Strd/CdtrRefInf). Absent when the
  // document uses unstructured remittance or no remittance at all.
  const structuredRemittance = extractStructuredRemittance(txEl)

  // Optional ultimate parties (name-only, pain.001.001.09 CreditTransferTransaction34).
  const ultimateDebtor = extractUltimateParty(txEl, 'UltmtDbtr')
  const ultimateCreditor = extractUltimateParty(txEl, 'UltmtCdtr')

  // Optional transaction-level purpose code (Purp/Cd, ExternalPurpose1Code).
  const purposeRaw = str(nav(txEl, 'Purp', 'Cd'))
  const purpose = purposeRaw !== null && purposeRaw !== '' ? purposeRaw : undefined

  return {
    endToEndId,
    amount,
    ...(ultimateDebtor !== undefined ? { ultimateDebtor } : {}),
    creditor,
    ...(ultimateCreditor !== undefined ? { ultimateCreditor } : {}),
    ...(purpose !== undefined ? { purpose } : {}),
    ...(remittanceInfo !== undefined ? { remittanceInfo } : {}),
    ...(structuredRemittance !== undefined ? { structuredRemittance } : {}),
  }
}

function extractPaymentBatch(pmtInfEl: unknown): PaymentBatch | null {
  if (!pmtInfEl || typeof pmtInfEl !== 'object') return null

  const id = str(nav(pmtInfEl, 'PmtInfId'))
  if (!id) return null

  // pain.001.001.09 wraps the date in DateAndDateTime2Choice: <ReqdExctnDt><Dt>YYYY-MM-DD</Dt></ReqdExctnDt>
  // pain.001.001.03 emits a plain text element: <ReqdExctnDt>YYYY-MM-DD</ReqdExctnDt>
  const executionDate = str(nav(pmtInfEl, 'ReqdExctnDt', 'Dt')) ?? str(nav(pmtInfEl, 'ReqdExctnDt'))
  if (!executionDate) return null

  // Debtor: Dbtr + DbtrAcct + DbtrAgt
  const dbtrEl = nav(pmtInfEl, 'Dbtr')
  const dbtrAcctEl = nav(pmtInfEl, 'DbtrAcct')
  const dbtrAgtEl = nav(pmtInfEl, 'DbtrAgt')
  const debtor = extractAccountParty(dbtrEl, dbtrAcctEl, dbtrAgtEl)
  if (!debtor) return null

  // Transactions (CdtTrfTxInf is always an array via isArray config)
  const txArray = nav(pmtInfEl, 'CdtTrfTxInf')
  if (!Array.isArray(txArray) || txArray.length === 0) return null

  const transfers: Transfer[] = []
  for (const txEl of txArray) {
    const transfer = extractTransfer(txEl)
    if (!transfer) return null
    transfers.push(transfer)
  }

  // Optional batch-level category purpose code (PmtTpInf/CtgyPurp/Cd, ExternalCategoryPurpose1Code).
  const categoryPurposeRaw = str(nav(pmtInfEl, 'PmtTpInf', 'CtgyPurp', 'Cd'))
  const categoryPurpose =
    categoryPurposeRaw !== null && categoryPurposeRaw !== '' ? categoryPurposeRaw : undefined

  return {
    id,
    executionDate,
    debtor,
    ...(categoryPurpose !== undefined ? { categoryPurpose } : {}),
    transfers,
  }
}

// ---------------------------------------------------------------------------
// pain.008 extractor functions
// ---------------------------------------------------------------------------

/**
 * Parse the InstdAmt element which appears directly on DrctDbtTxInf
 * (not wrapped in Amt like pain.001).
 * Format: <InstdAmt Ccy="EUR">123.45</InstdAmt>
 */
function extractInstdAmt(txEl: unknown): Money | null {
  const instdAmt = nav(txEl, 'InstdAmt')
  let amountStr: string | null = null
  let ccy = 'EUR'
  if (typeof instdAmt === 'object' && instdAmt !== null) {
    const amtObj = instdAmt as Record<string, unknown>
    amountStr = str(amtObj['#text'])
    const rawCcy = amtObj['@_Ccy']
    ccy = typeof rawCcy === 'string' ? rawCcy : 'EUR'
  } else {
    amountStr = str(instdAmt)
  }
  if (!amountStr) return null
  return parseMoneyString(amountStr, ccy)
}

/**
 * Extract a MandateAmendment from an AmdmntInfDtls element, if present.
 * Returns undefined when the element is absent or has no recognized fields.
 * Never returns an empty object, preserving round-trip deep-equality.
 *
 * Extracted fields (AmendmentInformationDetails13):
 *   OrgnlMndtId          -> originalMandateId
 *   OrgnlDbtrAcct/Id/IBAN -> originalDebtorAccount
 *   OrgnlDbtrAgt/FinInstnId/Othr/Id = "SMNDA" -> sameMandateNewDebtorAccount: true
 *
 * Other sub-fields (OrgnlCdtrSchmeId, OrgnlDbtr, etc.) are not modelled and are ignored.
 */
function extractMandateAmendment(amdmntInfDtlsEl: unknown): MandateAmendment | undefined {
  if (amdmntInfDtlsEl === null || amdmntInfDtlsEl === undefined) {
    return undefined
  }

  const originalMandateId = str(nav(amdmntInfDtlsEl, 'OrgnlMndtId')) ?? undefined
  const originalDebtorAccount = str(nav(amdmntInfDtlsEl, 'OrgnlDbtrAcct', 'Id', 'IBAN')) ?? undefined

  // SMNDA is signaled by OrgnlDbtrAgt/FinInstnId/Othr/Id = "SMNDA"
  const smndaId = str(nav(amdmntInfDtlsEl, 'OrgnlDbtrAgt', 'FinInstnId', 'Othr', 'Id'))
  const sameMandateNewDebtorAccount = smndaId === 'SMNDA' ? true : undefined

  // If no field was populated, return undefined (no empty object, preserves round-trip deep-equality)
  if (
    originalMandateId === undefined &&
    originalDebtorAccount === undefined &&
    sameMandateNewDebtorAccount === undefined
  ) {
    return undefined
  }

  const amd: MandateAmendment = {}
  if (originalMandateId !== undefined) amd.originalMandateId = originalMandateId
  if (originalDebtorAccount !== undefined) amd.originalDebtorAccount = originalDebtorAccount
  if (sameMandateNewDebtorAccount !== undefined) amd.sameMandateNewDebtorAccount = sameMandateNewDebtorAccount
  return amd
}

function extractCollection(txEl: unknown): Collection | null {
  if (!txEl || typeof txEl !== 'object') return null

  const endToEndId = str(nav(txEl, 'PmtId', 'EndToEndId'))
  if (!endToEndId) return null

  const amount = extractInstdAmt(txEl)
  if (!amount) return null

  // Mandate: DrctDbtTx/MndtRltdInf
  const mandateId = str(nav(txEl, 'DrctDbtTx', 'MndtRltdInf', 'MndtId'))
  if (!mandateId) return null
  const signatureDate = str(nav(txEl, 'DrctDbtTx', 'MndtRltdInf', 'DtOfSgntr'))
  if (!signatureDate) return null

  // Optional amendment: AmdmntInfDtls (only extracted when AmdmntInd=true is present)
  const amdmntInd = str(nav(txEl, 'DrctDbtTx', 'MndtRltdInf', 'AmdmntInd'))
  const amendment = amdmntInd === 'true' ? extractMandateAmendment(nav(txEl, 'DrctDbtTx', 'MndtRltdInf', 'AmdmntInfDtls')) : undefined

  const mandate: Mandate = {
    id: mandateId,
    signatureDate,
    ...(amendment !== undefined ? { amendment } : {}),
  }

  // Debtor: Dbtr + DbtrAcct + DbtrAgt
  const dbtrEl = nav(txEl, 'Dbtr')
  const dbtrName = str(nav(dbtrEl, 'Nm'))
  if (!dbtrName) return null
  const dbtrIban = str(nav(txEl, 'DbtrAcct', 'Id', 'IBAN'))
  if (!dbtrIban) return null
  // Try BICFI (modern) then fall back to BIC (legacy .02).
  const dbtrBic =
    str(nav(txEl, 'DbtrAgt', 'FinInstnId', 'BICFI')) ??
    str(nav(txEl, 'DbtrAgt', 'FinInstnId', 'BIC')) ??
    undefined
  const dbtrAddress = extractPstlAdr(dbtrEl)

  const debtor = {
    name: dbtrName,
    iban: dbtrIban,
    ...(dbtrBic !== undefined ? { bic: dbtrBic } : {}),
    ...(dbtrAddress !== undefined ? { address: dbtrAddress } : {}),
  }

  // Optional remittanceInfo. Treat empty strings as absent (defensive against empty elements).
  const ustrdRaw = str(nav(txEl, 'RmtInf', 'Ustrd'))
  const remittanceInfo = ustrdRaw !== null && ustrdRaw !== '' ? ustrdRaw : undefined

  // Optional structured remittance (RmtInf/Strd/CdtrRefInf). Absent when the
  // document uses unstructured remittance or no remittance at all.
  const structuredRemittance = extractStructuredRemittance(txEl)

  // Optional ultimate parties (name-only, pain.008.001.08 DirectDebitTransactionInformation23).
  const ultimateCreditor = extractUltimateParty(txEl, 'UltmtCdtr')
  const ultimateDebtor = extractUltimateParty(txEl, 'UltmtDbtr')

  // Optional transaction-level purpose code (Purp/Cd, ExternalPurpose1Code).
  const purposeRaw = str(nav(txEl, 'Purp', 'Cd'))
  const purpose = purposeRaw !== null && purposeRaw !== '' ? purposeRaw : undefined

  return {
    endToEndId,
    amount,
    ...(ultimateCreditor !== undefined ? { ultimateCreditor } : {}),
    debtor,
    ...(ultimateDebtor !== undefined ? { ultimateDebtor } : {}),
    mandate,
    ...(purpose !== undefined ? { purpose } : {}),
    ...(remittanceInfo !== undefined ? { remittanceInfo } : {}),
    ...(structuredRemittance !== undefined ? { structuredRemittance } : {}),
  }
}

function extractDirectDebitBatch(pmtInfEl: unknown): DirectDebitBatch | null {
  if (!pmtInfEl || typeof pmtInfEl !== 'object') return null

  const id = str(nav(pmtInfEl, 'PmtInfId'))
  if (!id) return null

  const collectionDate = str(nav(pmtInfEl, 'ReqdColltnDt'))
  if (!collectionDate) return null

  // Sequence type (PmtTpInf/SeqTp)
  const seqTpRaw = str(nav(pmtInfEl, 'PmtTpInf', 'SeqTp'))
  if (!seqTpRaw) return null
  const validSeqTypes: SequenceType[] = ['FRST', 'RCUR', 'OOFF', 'FNAL']
  if (!validSeqTypes.includes(seqTpRaw as SequenceType)) return null
  const sequenceType = seqTpRaw as SequenceType

  // Local instrument (PmtTpInf/LclInstrm/Cd) - always present in our writer
  const lclInstrmRaw = str(nav(pmtInfEl, 'PmtTpInf', 'LclInstrm', 'Cd'))
  const validLocalInstruments: LocalInstrument[] = ['CORE', 'B2B']
  const localInstrument: LocalInstrument =
    lclInstrmRaw !== null && validLocalInstruments.includes(lclInstrmRaw as LocalInstrument)
      ? (lclInstrmRaw as LocalInstrument)
      : 'CORE'

  // DrctDbtTxInf (always an array via isArray config)
  const txArray = nav(pmtInfEl, 'DrctDbtTxInf')
  if (!Array.isArray(txArray) || txArray.length === 0) return null

  const collections: Collection[] = []
  for (const txEl of txArray) {
    const collection = extractCollection(txEl)
    if (!collection) return null
    collections.push(collection)
  }

  // Optional batch-level category purpose code (PmtTpInf/CtgyPurp/Cd, ExternalCategoryPurpose1Code).
  const categoryPurposeRaw = str(nav(pmtInfEl, 'PmtTpInf', 'CtgyPurp', 'Cd'))
  const categoryPurpose =
    categoryPurposeRaw !== null && categoryPurposeRaw !== '' ? categoryPurposeRaw : undefined

  return {
    id,
    collectionDate,
    sequenceType,
    localInstrument,
    ...(categoryPurpose !== undefined ? { categoryPurpose } : {}),
    collections,
  }
}

function extractCreditorFromPmtInf(pmtInfEl: unknown): Creditor | null {
  if (!pmtInfEl || typeof pmtInfEl !== 'object') return null

  const cdtrEl = nav(pmtInfEl, 'Cdtr')
  const name = str(nav(cdtrEl, 'Nm'))
  if (!name) return null

  const iban = str(nav(pmtInfEl, 'CdtrAcct', 'Id', 'IBAN'))
  if (!iban) return null

  // Try BICFI (modern) then fall back to BIC (legacy .02).
  const bic =
    str(nav(pmtInfEl, 'CdtrAgt', 'FinInstnId', 'BICFI')) ??
    str(nav(pmtInfEl, 'CdtrAgt', 'FinInstnId', 'BIC')) ??
    undefined

  const address = extractPstlAdr(cdtrEl)

  // CdtrSchmeId/Id/PrvtId/Othr/Id
  const creditorId = str(nav(pmtInfEl, 'CdtrSchmeId', 'Id', 'PrvtId', 'Othr', 'Id'))
  if (!creditorId) return null

  return {
    name,
    iban,
    ...(bic !== undefined ? { bic } : {}),
    ...(address !== undefined ? { address } : {}),
    creditorId,
  }
}

// ---------------------------------------------------------------------------
// Main parse function (auto-detects namespace)
// ---------------------------------------------------------------------------

/**
 * Parse a SEPA XML string, auto-detecting pain.001 or pain.008 by xmlns.
 *
 * Namespace detection: reads the xmlns attribute from the raw XML string using
 * a regex. This is more reliable than trying to extract it from the XMLParser
 * output, which may not preserve xmlns as a regular attribute.
 *
 * This function never throws. All failure modes return { ok: false, error }.
 *
 * @param xml the XML string to parse
 * @returns ParseResult discriminated union
 */
export function parse(xml: string): ParseResult {
  // Runtime type guard: protects against non-string values reaching the parser
  if (typeof xml !== 'string') {
    return { ok: false, error: 'Input must be a string' }
  }

  // Reject empty or whitespace-only input before attempting to parse
  if (xml.trim() === '') {
    return { ok: false, error: 'Input is empty or whitespace only' }
  }

  // Detect namespace from raw XML before parsing (regex on string is reliable)
  const nsMatch = xml.match(/xmlns\s*=\s*["']([^"']+)["']/)
  const ns = nsMatch ? (nsMatch[1] ?? null) : null

  // Require an explicit xmlns declaration: no namespace means not a SEPA document
  if (ns === null) {
    return { ok: false, error: 'Missing xmlns attribute: not a recognized SEPA document' }
  }

  let parsed: unknown
  try {
    parsed = PARSER.parse(xml)
  } catch (e) {
    return {
      ok: false,
      error: `XML parse error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  // Extract a short version string from the namespace URI, e.g. "pain.001.001.09".
  const version = ns.split(':xsd:')[1] ?? ns

  try {
    if (ns === NS_PAIN008_08 || ns === NS_PAIN008_02 || ns === NS_PAIN008_003_02) {
      return parsePain008(parsed, version)
    }

    if (ns === NS_PAIN001_09 || ns === NS_PAIN001_03 || ns === NS_PAIN001_003_03) {
      return parsePain001(parsed, version)
    }

    return {
      ok: false,
      error: `Unknown XML namespace: "${ns}". Supported: pain.001.001.09, pain.001.001.03, pain.001.003.03, pain.008.001.08, pain.008.001.02, pain.008.003.02.`,
    }
  } catch (e) {
    return {
      ok: false,
      error: `Parse error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// pain.001 sub-parser (handles pain.001.001.09 and pain.001.001.03)
// ---------------------------------------------------------------------------

function parsePain001(parsed: unknown, version: string): ParseResult {
  try {
    const root = nav(parsed, 'Document', 'CstmrCdtTrfInitn')
    if (!root) {
      return { ok: false, error: 'Missing Document/CstmrCdtTrfInitn element' }
    }

    const grpHdr = nav(root, 'GrpHdr')
    if (!grpHdr) {
      return { ok: false, error: 'Missing GrpHdr element' }
    }

    const messageId = str(nav(grpHdr, 'MsgId'))
    if (!messageId) {
      return { ok: false, error: 'Missing GrpHdr/MsgId' }
    }

    const createdAt = str(nav(grpHdr, 'CreDtTm'))
    if (!createdAt) {
      return { ok: false, error: 'Missing GrpHdr/CreDtTm' }
    }

    const initiatingParty = str(nav(grpHdr, 'InitgPty', 'Nm'))
    if (!initiatingParty) {
      return { ok: false, error: 'Missing GrpHdr/InitgPty/Nm' }
    }

    const pmtInfArray = nav(root, 'PmtInf')
    if (!Array.isArray(pmtInfArray) || pmtInfArray.length === 0) {
      return { ok: false, error: 'Missing or empty PmtInf elements' }
    }

    const batches: PaymentBatch[] = []
    for (const pmtInfEl of pmtInfArray) {
      const batch = extractPaymentBatch(pmtInfEl)
      if (!batch) {
        return { ok: false, error: 'Failed to extract PaymentBatch from PmtInf' }
      }
      batches.push(batch)
    }

    const rawDoc: CreditTransferDocument = {
      messageId,
      createdAt,
      initiatingParty,
      batches,
    }

    const validation = CreditTransferDocumentSchema.safeParse(rawDoc)
    if (!validation.success) {
      const messages = validation.error.issues
        .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
        .join('; ')
      return { ok: false, error: `Model validation failed after parse: ${messages}` }
    }

    return { ok: true, type: 'pain.001', version, data: validation.data }
  } catch (e) {
    return {
      ok: false,
      error: `pain.001 parse error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// pain.008 sub-parser (handles pain.008.001.08 and pain.008.001.02)
// ---------------------------------------------------------------------------

function parsePain008(parsed: unknown, version: string): ParseResult {
  try {
    const root = nav(parsed, 'Document', 'CstmrDrctDbtInitn')
    if (!root) {
      return { ok: false, error: 'Missing Document/CstmrDrctDbtInitn element' }
    }

    const grpHdr = nav(root, 'GrpHdr')
    if (!grpHdr) {
      return { ok: false, error: 'Missing GrpHdr element' }
    }

    const messageId = str(nav(grpHdr, 'MsgId'))
    if (!messageId) {
      return { ok: false, error: 'Missing GrpHdr/MsgId' }
    }

    const createdAt = str(nav(grpHdr, 'CreDtTm'))
    if (!createdAt) {
      return { ok: false, error: 'Missing GrpHdr/CreDtTm' }
    }

    const initiatingParty = str(nav(grpHdr, 'InitgPty', 'Nm'))
    if (!initiatingParty) {
      return { ok: false, error: 'Missing GrpHdr/InitgPty/Nm' }
    }

    const pmtInfArray = nav(root, 'PmtInf')
    if (!Array.isArray(pmtInfArray) || pmtInfArray.length === 0) {
      return { ok: false, error: 'Missing or empty PmtInf elements' }
    }

    // Extract creditor from the first PmtInf (same value is fanned out to all)
    const creditor = extractCreditorFromPmtInf(pmtInfArray[0])
    if (!creditor) {
      return { ok: false, error: 'Failed to extract Creditor from first PmtInf' }
    }

    const batches: DirectDebitBatch[] = []
    for (const pmtInfEl of pmtInfArray) {
      const batch = extractDirectDebitBatch(pmtInfEl)
      if (!batch) {
        return { ok: false, error: 'Failed to extract DirectDebitBatch from PmtInf' }
      }
      batches.push(batch)
    }

    const rawDoc: DirectDebitDocument = {
      messageId,
      createdAt,
      initiatingParty,
      creditor,
      batches,
    }

    const validation = DirectDebitDocumentSchema.safeParse(rawDoc)
    if (!validation.success) {
      const messages = validation.error.issues
        .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
        .join('; ')
      return { ok: false, error: `Model validation failed after parse: ${messages}` }
    }

    return { ok: true, type: 'pain.008', version, data: validation.data }
  } catch (e) {
    return {
      ok: false,
      error: `pain.008 parse error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}
