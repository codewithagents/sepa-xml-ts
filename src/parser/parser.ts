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
import { detectSepaNamespace } from '../xmlns-detect.js'
import { XML_REFERENCE_DECODER } from '../xml-references.js'
import { findWellFormednessProblem } from '../xml-wellformedness.js'
import type { MessageType } from '../message-types.js'
import { resolveSepaCharset, SepaCharset } from '../model/charset.js'
import {
  creditTransferSchemasFor,
  type CreditTransferDocument,
  type AccountParty,
  type Transfer,
  type PaymentBatch,
  type Money,
  type PostalAddress,
  type UltimateParty,
  type PartyIdentification,
  type GenericIdentification,
  type OrganisationIdentification,
  type PrivateIdentification,
  type DateAndPlaceOfBirth,
  type StructuredRemittance,
  type ReferredDocument,
  type RemittanceAmount,
  type Purpose,
  type CategoryPurpose,
} from '../model/schema.js'
import {
  directDebitSchemasFor,
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
  /** Discriminator matching `MessageType.CreditTransfer` ("pain.001"). */
  type: typeof MessageType.CreditTransfer
  /** Detected schema version, e.g. "pain.001.001.09" or "pain.001.001.03". */
  version?: string
  data: CreditTransferDocument
}
export type ParseSuccess008 = {
  ok: true
  /** Discriminator matching `MessageType.DirectDebit` ("pain.008"). */
  type: typeof MessageType.DirectDebit
  /** Detected schema version, e.g. "pain.008.001.08" or "pain.008.001.02". */
  version?: string
  data: DirectDebitDocument
}
export type ParseFailure = { ok: false; error: string }
export type ParseResult = ParseSuccess001 | ParseSuccess008 | ParseFailure

/** Options accepted by parse. */
export interface ParseOptions {
  /**
   * The character set accepted in human-readable text fields (names, addresses,
   * remittance information). Defaults to 'extended' (SepaCharset.Extended): EPC217-08
   * asks a receiver to process text as received and to reject only characters outside
   * the conversion table, so a file with č š ž in a name parses. Pass 'basic'
   * (SepaCharset.Basic) to accept only the basic Latin set. Identifiers, references and
   * codes must be basic Latin in every mode (EPC217-08 section 6.3). A parsed document
   * with extended text needs { charset: 'extended' } to be written again.
   */
  charset?: SepaCharset
}

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
  // Text is kept as XML reads it (CDATA and the text around a processing instruction
  // join without losing spaces); textOf trims only XML whitespace at the edges.
  trimValues: false,
  ignorePiTags: true,
  // XML expands references in text and attribute values only, never in a processing
  // instruction, whose pseudo-attributes fast-xml-parser reads under a "?target" name.
  processEntities: { tagFilter: (tagName) => !tagName.startsWith('?') },
  entityDecoder: XML_REFERENCE_DECODER,
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

const PAIN001_NAMESPACES: ReadonlySet<string> = new Set([
  NS_PAIN001_09,
  NS_PAIN001_03,
  NS_PAIN001_003_03,
])
const PAIN008_NAMESPACES: ReadonlySet<string> = new Set([
  NS_PAIN008_08,
  NS_PAIN008_02,
  NS_PAIN008_003_02,
])

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
  if (!/^\d+(\.\d{1,2})?$/.test(amountStr)) {
    return null
  }
  const parts = amountStr.split('.')
  const wholePart = parts[0] ?? '0'
  const fracPart = (parts[1] ?? '0').padEnd(2, '0')
  const minorUnits = BigInt(wholePart) * 100n + BigInt(fracPart)
  return { currencyCode: 'EUR', minorUnits }
}

const TEXT_NODE = '#text'
const ATTRIBUTE_PREFIX = '@_'

/** The elements the model reads as lists. Every other element it reads occurs at most once. */
const REPEATABLE_ELEMENTS: ReadonlySet<string> = new Set([
  'PmtInf',
  'CdtTrfTxInf',
  'DrctDbtTxInf',
  'RfrdDocInf',
  'AdrLine',
])

/**
 * An element the model reads is present, but not in a shape the model can hold: it repeats
 * where the model holds one value, or it holds child elements where the model holds text.
 * parse() returns ok:false with this message instead of dropping the element.
 */
class UnreadableElementError extends Error {}

function isXmlWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0d || code === 0x0a
}

/** Remove XML whitespace (space, tab, CR, LF) from both ends; other spaces are text. */
function trimXmlWhitespace(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && isXmlWhitespace(value.charCodeAt(start))) start++
  while (end > start && isXmlWhitespace(value.charCodeAt(end - 1))) end--
  return value.slice(start, end)
}

/** The child element `name` of a parsed element, or null/undefined when absent. */
function child(parent: unknown, name: string): unknown {
  if (parent === null || parent === undefined || typeof parent !== 'object') {
    return null
  }
  const value = (parent as Record<string, unknown>)[name]
  if (Array.isArray(value) && !REPEATABLE_ELEMENTS.has(name)) {
    throw new UnreadableElementError(
      `Cannot read <${name}>: it occurs ${value.length} times, but the model holds a single value`
    )
  }
  return value
}

/** Safely get a nested value by path, returning null if any step is missing. */
function nav(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj
  for (const key of keys) {
    cur = child(cur, key)
  }
  return cur
}

/**
 * The text of an element the model reads as one string, or null when the element is
 * absent. The text is everything XML reads as the element's character data (CDATA
 * sections and the text around comments and processing instructions included), with XML
 * whitespace trimmed at both ends.
 *
 * @param attributes the attributes the model reads from this element (Ccy on an amount)
 * @throws UnreadableElementError when the element holds child elements or another
 *   attribute (a namespace declaration included, since xmlns="..." would change the
 *   element's namespace)
 */
function textOf(value: unknown, name: string, attributes: readonly string[] = []): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return trimXmlWhitespace(value)
  const fields = value as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (key === TEXT_NODE) continue
    if (!key.startsWith(ATTRIBUTE_PREFIX)) {
      throw new UnreadableElementError(
        `Cannot read <${name}>: it contains the element <${key}>, but the model holds text`
      )
    }
    const attribute = key.slice(ATTRIBUTE_PREFIX.length)
    if (!attributes.includes(attribute)) {
      throw new UnreadableElementError(
        `Cannot read <${name}>: it carries the attribute ${attribute}, which the model does not hold`
      )
    }
  }
  const text = fields[TEXT_NODE]
  return trimXmlWhitespace(typeof text === 'string' ? text : '')
}

/** The text of the element at `path` below `parent` (see textOf), or null when absent. */
function textAt(parent: unknown, ...path: string[]): string | null {
  return textOf(nav(parent, ...path), path.at(-1) ?? '')
}

/** An attribute value of a parsed element with XML whitespace trimmed, or null when absent. */
function attributeOf(element: unknown, name: string): string | null {
  if (element === null || typeof element !== 'object') return null
  const value = (element as Record<string, unknown>)[`${ATTRIBUTE_PREFIX}${name}`]
  return typeof value === 'string' ? trimXmlWhitespace(value) : null
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

  const streetName = textAt(pstlAdrEl, 'StrtNm') ?? undefined
  const buildingNumber = textAt(pstlAdrEl, 'BldgNb') ?? undefined
  const postCode = textAt(pstlAdrEl, 'PstCd') ?? undefined
  const townName = textAt(pstlAdrEl, 'TwnNm') ?? undefined
  const countrySubDivision = textAt(pstlAdrEl, 'CtrySubDvsn') ?? undefined
  const country = textAt(pstlAdrEl, 'Ctry') ?? undefined

  // AdrLine can be a single element (when only one line) or an array
  const lines = asArray(nav(pstlAdrEl, 'AdrLine'))
    .map((l: unknown) => textOf(l, 'AdrLine'))
    .filter((l): l is string => l !== null && l !== '')
  const addressLines = lines.length > 0 ? lines : undefined

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
  const name = textAt(el, 'Nm')
  if (name === null || name === '') {
    return undefined
  }
  const id = extractPartyId(el)
  if (id === undefined) {
    return { name }
  }
  return { name, id }
}

/**
 * Extract a generic identifier (Othr) from an OrgId or PrvtId element.
 * Returns undefined when Othr is absent or has no Id child.
 *
 * Reads Othr/Id, Othr/SchmeNm/Cd, Othr/Issr (the subset our writer emits).
 */
function extractGenericOther(parentEl: unknown): GenericIdentification | undefined {
  const othrEl = nav(parentEl, 'Othr')
  if (othrEl === null || othrEl === undefined) {
    return undefined
  }
  const id = textAt(othrEl, 'Id')
  if (id === null || id === '') {
    return undefined
  }
  const schemeName = textAt(othrEl, 'SchmeNm', 'Cd') ?? undefined
  const issuer = textAt(othrEl, 'Issr') ?? undefined
  const out: GenericIdentification = { id }
  if (schemeName !== undefined) out.schemeName = schemeName
  if (issuer !== undefined) out.issuer = issuer
  return out
}

/**
 * Read a non-empty string from a path, or return null.
 * Combines the common textAt() + empty-check pattern.
 */
function requiredTextAt(parent: unknown, ...path: string[]): string | null {
  const text = textAt(parent, ...path)
  return text !== null && text !== '' ? text : null
}

/**
 * Extract an OrganisationIdentification from an OrgId element.
 * Returns undefined when OrgId is absent or yields no meaningful fields.
 */
function extractOrgId(idEl: unknown): OrganisationIdentification | undefined {
  const orgEl = nav(idEl, 'OrgId')
  if (orgEl === null || orgEl === undefined) {
    return undefined
  }
  const bic = textAt(orgEl, 'AnyBIC') ?? undefined
  const lei = textAt(orgEl, 'LEI') ?? undefined
  const other = extractGenericOther(orgEl)
  if (bic === undefined && lei === undefined && other === undefined) {
    return undefined
  }
  const org: OrganisationIdentification = {}
  if (bic !== undefined) org.bic = bic
  if (lei !== undefined) org.lei = lei
  if (other !== undefined) org.other = other
  return org
}

/**
 * Extract a DateAndPlaceOfBirth from a DtAndPlcOfBirth element inside a PrvtId.
 * Returns undefined when the element is absent or lacks required children.
 */
function extractDateAndPlaceOfBirth(prvtEl: unknown): DateAndPlaceOfBirth | undefined {
  const dobEl = nav(prvtEl, 'DtAndPlcOfBirth')
  if (dobEl === null || dobEl === undefined) {
    return undefined
  }
  const birthDate = requiredTextAt(dobEl, 'BirthDt')
  const cityOfBirth = requiredTextAt(dobEl, 'CityOfBirth')
  const countryOfBirth = requiredTextAt(dobEl, 'CtryOfBirth')
  if (birthDate === null || cityOfBirth === null || countryOfBirth === null) {
    return undefined
  }
  const out: DateAndPlaceOfBirth = { birthDate, cityOfBirth, countryOfBirth }
  const provinceOfBirth = textAt(dobEl, 'PrvcOfBirth') ?? undefined
  if (provinceOfBirth !== undefined) out.provinceOfBirth = provinceOfBirth
  return out
}

/**
 * Extract a PrivateIdentification from a PrvtId element.
 * Returns undefined when PrvtId is absent or yields no meaningful fields.
 */
function extractPrvtId(idEl: unknown): PrivateIdentification | undefined {
  const prvtEl = nav(idEl, 'PrvtId')
  if (prvtEl === null || prvtEl === undefined) {
    return undefined
  }
  const dob = extractDateAndPlaceOfBirth(prvtEl)
  const other = extractGenericOther(prvtEl)
  if (dob === undefined && other === undefined) {
    return undefined
  }
  const prvt: PrivateIdentification = {}
  if (dob !== undefined) prvt.dateAndPlaceOfBirth = dob
  if (other !== undefined) prvt.other = other
  return prvt
}

/**
 * Extract a structured party identification (Id, Party38Choice) from a party
 * element (e.g. UltmtDbdr / UltmtCdtr). Delegates to extractOrgId / extractPrvtId.
 *
 * Returns undefined when no Id element is present or when neither branch yields
 * any data, preserving round-trip deep-equality for parties without an id.
 */
function extractPartyId(partyEl: unknown): PartyIdentification | undefined {
  const idEl = nav(partyEl, 'Id')
  if (idEl === null || idEl === undefined) {
    return undefined
  }
  const organisationId = extractOrgId(idEl)
  if (organisationId !== undefined) {
    return { organisationId }
  }
  const privateId = extractPrvtId(idEl)
  if (privateId !== undefined) {
    return { privateId }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// StructuredRemittance extractor
// ---------------------------------------------------------------------------

/**
 * Coerce a value that may be a single object or an array into an array. Used for
 * XSD-repeatable elements that fast-xml-parser does not force into arrays (e.g.
 * RfrdDocInf, which is an object when single and an array when repeated).
 */
function asArray(val: unknown): unknown[] {
  if (val === null || val === undefined) return []
  return Array.isArray(val) ? val : [val]
}

/**
 * Extract a CdOrPrtry choice (Cd string XOR { proprietary }) from a CdOrPrtry
 * wrapper element. Returns undefined when neither child is present.
 *
 * @param cdOrPrtryEl - the CdOrPrtry element (or null/undefined when absent)
 */
function extractCdOrPrtry(cdOrPrtryEl: unknown): string | { proprietary: string } | undefined {
  if (cdOrPrtryEl === null || cdOrPrtryEl === undefined) return undefined
  const cd = textAt(cdOrPrtryEl, 'Cd')
  if (cd !== null && cd !== '') return cd
  const prtry = textAt(cdOrPrtryEl, 'Prtry')
  if (prtry !== null && prtry !== '') return { proprietary: prtry }
  return undefined
}

/**
 * Parse an EUR amount element (e.g. InstdAmt, DuePyblAmt) which carries a Ccy attribute
 * and a text value: <DuePyblAmt Ccy="EUR">12.34</DuePyblAmt>. Returns null when absent
 * or not a valid EUR amount.
 *
 * @param parent the element that holds the amount element
 * @param path the path to the amount element
 */
function parseAmtElement(parent: unknown, ...path: string[]): Money | null {
  const amtEl = nav(parent, ...path)
  const amountStr = textOf(amtEl, path.at(-1) ?? '', ['Ccy'])
  if (amountStr === null) return null
  return parseMoneyString(amountStr, attributeOf(amtEl, 'Ccy') ?? 'EUR')
}

/**
 * Extract one referred document (ReferredDocumentInformation7) from a RfrdDocInf
 * element. Reads Tp/CdOrPrtry, Nb, RltdDt. Returns undefined when no field is set.
 */
function extractRfrdDocInf(docEl: unknown): ReferredDocument | undefined {
  const type = extractCdOrPrtry(nav(docEl, 'Tp', 'CdOrPrtry'))
  const number = textAt(docEl, 'Nb') ?? undefined
  const relatedDate = textAt(docEl, 'RltdDt') ?? undefined
  if (type === undefined && number === undefined && relatedDate === undefined) {
    return undefined
  }
  return {
    ...(type !== undefined ? { type: type as ReferredDocument['type'] } : {}),
    ...(number !== undefined && number !== '' ? { number } : {}),
    ...(relatedDate !== undefined && relatedDate !== '' ? { relatedDate } : {}),
  }
}

/**
 * Extract the referred-document amounts (RemittanceAmount2) from a RfrdDocAmt
 * element. Reads DuePyblAmt, CdtNoteAmt, RmtdAmt. Returns undefined when none set.
 */
function extractRfrdDocAmt(amtEl: unknown): RemittanceAmount | undefined {
  if (amtEl === null || amtEl === undefined) return undefined
  const duePayableAmount = parseAmtElement(amtEl, 'DuePyblAmt') ?? undefined
  const creditNoteAmount = parseAmtElement(amtEl, 'CdtNoteAmt') ?? undefined
  const remittedAmount = parseAmtElement(amtEl, 'RmtdAmt') ?? undefined
  if (
    duePayableAmount === undefined &&
    creditNoteAmount === undefined &&
    remittedAmount === undefined
  ) {
    return undefined
  }
  return {
    ...(duePayableAmount !== undefined ? { duePayableAmount } : {}),
    ...(creditNoteAmount !== undefined ? { creditNoteAmount } : {}),
    ...(remittedAmount !== undefined ? { remittedAmount } : {}),
  }
}

/**
 * Extract the CdtrRefInf fields (creditorReference, referenceType, issuer) from a
 * CdtrRefInf element. Returns a partial object (creditorReference set when present).
 */
function extractCdtrRefInf(cdtrRefInfEl: unknown): Partial<StructuredRemittance> {
  if (cdtrRefInfEl === null || cdtrRefInfEl === undefined) return {}
  const creditorReference = textAt(cdtrRefInfEl, 'Ref')
  if (creditorReference === null || creditorReference === '') return {}
  // Tp/CdOrPrtry is the reference type (Cd enum XOR Prtry). We cast the raw value
  // here; out-of-enum Cd values are rejected by post-parse model validation.
  const referenceType = extractCdOrPrtry(nav(cdtrRefInfEl, 'Tp', 'CdOrPrtry'))
  const issuer = textAt(cdtrRefInfEl, 'Tp', 'Issr') ?? undefined
  return {
    creditorReference,
    ...(referenceType !== undefined
      ? { referenceType: referenceType as StructuredRemittance['referenceType'] }
      : {}),
    ...(issuer !== undefined ? { issuer } : {}),
  }
}

/**
 * Extract structured remittance information from a transaction element.
 *
 * Reads RmtInf/Strd:
 *   referredDocuments      <- RfrdDocInf (0..n)
 *   referredDocumentAmount <- RfrdDocAmt
 *   creditorReference      <- CdtrRefInf/Ref (+ referenceType, issuer)
 *
 * Returns undefined when Strd is absent or carries no meaningful content, so
 * round-trip deep-equal holds for documents without structured remittance. The
 * Ustrd path is handled separately.
 *
 * @param txEl - the transaction element (CdtTrfTxInf or DrctDbtTxInf)
 */
function extractStructuredRemittance(txEl: unknown): StructuredRemittance | undefined {
  const strdEl = nav(txEl, 'RmtInf', 'Strd')
  if (strdEl === null || strdEl === undefined) {
    return undefined
  }

  const referredDocuments = asArray(nav(strdEl, 'RfrdDocInf'))
    .map((d) => extractRfrdDocInf(d))
    .filter((d): d is ReferredDocument => d !== undefined)
  const referredDocumentAmount = extractRfrdDocAmt(nav(strdEl, 'RfrdDocAmt'))
  const cdtrRef = extractCdtrRefInf(nav(strdEl, 'CdtrRefInf'))

  if (
    referredDocuments.length === 0 &&
    referredDocumentAmount === undefined &&
    cdtrRef.creditorReference === undefined
  ) {
    return undefined
  }

  return {
    ...(referredDocuments.length > 0 ? { referredDocuments } : {}),
    ...(referredDocumentAmount !== undefined ? { referredDocumentAmount } : {}),
    ...cdtrRef,
  }
}

/**
 * Extract a purpose choice (Purpose2Choice / CategoryPurpose1Choice) from a
 * wrapper element such as Purp or PmtTpInf/CtgyPurp. Reads Cd (returned as a
 * plain string) or Prtry (returned as { proprietary }). Returns undefined when
 * the wrapper is absent or carries neither child.
 *
 * @param choiceEl - the Purp or CtgyPurp element (or null/undefined when absent)
 */
function extractPurposeChoice(choiceEl: unknown): Purpose | undefined {
  if (choiceEl === null || choiceEl === undefined) return undefined
  const cd = textAt(choiceEl, 'Cd')
  if (cd !== null && cd !== '') return cd
  const prtry = textAt(choiceEl, 'Prtry')
  if (prtry !== null && prtry !== '') return { proprietary: prtry }
  return undefined
}

// ---------------------------------------------------------------------------
// pain.001 extractor functions
// ---------------------------------------------------------------------------

function extractAccountParty(
  partyEl: unknown,
  acctEl: unknown,
  agtEl: unknown
): AccountParty | null {
  const name = textAt(partyEl, 'Nm')
  if (!name) return null

  const iban = textAt(acctEl, 'Id', 'IBAN')
  if (!iban) return null

  // Try BICFI (pain.001.001.09 / pain.008.001.08) then fall back to BIC (pain.001.001.03 / .02).
  const bic =
    textAt(agtEl, 'FinInstnId', 'BICFI') ?? textAt(agtEl, 'FinInstnId', 'BIC') ?? undefined

  const address = extractPstlAdr(partyEl)

  return {
    name,
    iban,
    ...(bic !== undefined ? { bic } : {}),
    ...(address !== undefined ? { address } : {}),
  }
}

function extractTransfer(txEl: unknown): Transfer | null {
  if (!txEl || typeof txEl !== 'object') return null

  const endToEndId = textAt(txEl, 'PmtId', 'EndToEndId')
  if (!endToEndId) return null

  // Amount: <Amt><InstdAmt Ccy="EUR">123.45</InstdAmt></Amt>
  const amount = parseAmtElement(txEl, 'Amt', 'InstdAmt')
  if (!amount) return null

  // Creditor: Cdtr + CdtrAcct + CdtrAgt (optional)
  const cdtrEl = nav(txEl, 'Cdtr')
  const cdtrAcctEl = nav(txEl, 'CdtrAcct')
  const cdtrAgtEl = nav(txEl, 'CdtrAgt')
  const creditor = extractAccountParty(cdtrEl, cdtrAcctEl, cdtrAgtEl)
  if (!creditor) return null

  // Optional remittanceInfo. Treat empty strings as absent; some older libraries
  // (e.g. sepa / kewisch.js) emit <RmtInf><Ustrd/></RmtInf> when no value is set.
  const ustrdRaw = textAt(txEl, 'RmtInf', 'Ustrd')
  const remittanceInfo = ustrdRaw !== null && ustrdRaw !== '' ? ustrdRaw : undefined

  // Optional structured remittance (RmtInf/Strd/CdtrRefInf). Absent when the
  // document uses unstructured remittance or no remittance at all.
  const structuredRemittance = extractStructuredRemittance(txEl)

  // Optional ultimate parties (name-only, pain.001.001.09 CreditTransferTransaction34).
  const ultimateDebtor = extractUltimateParty(txEl, 'UltmtDbtr')
  const ultimateCreditor = extractUltimateParty(txEl, 'UltmtCdtr')

  // Optional transaction-level purpose (Purp, Purpose2Choice: Cd or Prtry).
  const purpose = extractPurposeChoice(nav(txEl, 'Purp'))

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

  const id = textAt(pmtInfEl, 'PmtInfId')
  if (!id) return null

  // pain.001.001.09 wraps the date in DateAndDateTime2Choice: <ReqdExctnDt><Dt>YYYY-MM-DD</Dt></ReqdExctnDt>
  // pain.001.001.03 emits a plain text element: <ReqdExctnDt>YYYY-MM-DD</ReqdExctnDt>
  const executionDate = textAt(pmtInfEl, 'ReqdExctnDt', 'Dt') ?? textAt(pmtInfEl, 'ReqdExctnDt')
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

  // Optional batch-level category purpose (PmtTpInf/CtgyPurp, CategoryPurpose1Choice: Cd or Prtry).
  const categoryPurpose: CategoryPurpose | undefined = extractPurposeChoice(
    nav(pmtInfEl, 'PmtTpInf', 'CtgyPurp')
  )

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
 * Extract OrgnlCdtrSchmeId (PartyIdentification135) from an AmdmntInfDtls element.
 * Reads Nm and the SEPA Creditor Identifier (Id/PrvtId/Othr/Id). Returns undefined when neither is present.
 */
function extractOrgnlCdtrSchmeId(
  amdmntInfDtlsEl: unknown
): MandateAmendment['originalCreditorSchemeId'] {
  const schemeEl = nav(amdmntInfDtlsEl, 'OrgnlCdtrSchmeId')
  if (schemeEl === null || schemeEl === undefined) return undefined
  const name = textAt(schemeEl, 'Nm') ?? undefined
  const creditorId = textAt(schemeEl, 'Id', 'PrvtId', 'Othr', 'Id') ?? undefined
  if (name === undefined && creditorId === undefined) return undefined
  const scheme: MandateAmendment['originalCreditorSchemeId'] = {}
  if (name !== undefined) scheme.name = name
  if (creditorId !== undefined) scheme.creditorId = creditorId
  return scheme
}

/**
 * Extract OrgnlRsn (MandateSetupReason1Choice) from an AmdmntInfDtls element.
 * Reads Cd (returned as a plain string) or Prtry (returned as { proprietary }).
 */
function extractOrgnlRsn(amdmntInfDtlsEl: unknown): MandateAmendment['originalReason'] {
  const rsnEl = nav(amdmntInfDtlsEl, 'OrgnlRsn')
  if (rsnEl === null || rsnEl === undefined) return undefined
  const cd = textAt(rsnEl, 'Cd')
  if (cd !== null && cd !== '') return cd
  const prtry = textAt(rsnEl, 'Prtry')
  if (prtry !== null && prtry !== '') return { proprietary: prtry }
  return undefined
}

/**
 * Extract the OrgnlDbtrAgt branch of an amendment as a partial MandateAmendment.
 * OrgnlDbtrAgt has two disjoint shapes: the SMNDA marker (FinInstnId/Othr/Id="SMNDA")
 * or a real agent BIC (FinInstnId/BICFI). Returns whichever is present (or both keys absent).
 */
function extractOrgnlDbtrAgt(amdmntInfDtlsEl: unknown): Partial<MandateAmendment> {
  const smndaId = textAt(amdmntInfDtlsEl, 'OrgnlDbtrAgt', 'FinInstnId', 'Othr', 'Id')
  const bic = textAt(amdmntInfDtlsEl, 'OrgnlDbtrAgt', 'FinInstnId', 'BICFI') ?? undefined
  return {
    ...(smndaId === 'SMNDA' ? { sameMandateNewDebtorAccount: true } : {}),
    ...(bic !== undefined ? { originalDebtorAgent: bic } : {}),
  }
}

/**
 * Extract the scalar (plain string / date) fields of an amendment that need no special
 * sub-structure handling: originalMandateId, originalDebtorAccount, originalFinalCollectionDate,
 * originalFrequency, and originalReason.
 * Returns a Partial with only the keys that are present in the XML.
 */
function extractAmendmentScalarFields(amdmntInfDtlsEl: unknown): Partial<MandateAmendment> {
  const originalMandateId = textAt(amdmntInfDtlsEl, 'OrgnlMndtId') ?? undefined
  const originalDebtorAccount = textAt(amdmntInfDtlsEl, 'OrgnlDbtrAcct', 'Id', 'IBAN') ?? undefined
  const originalFinalCollectionDate = textAt(amdmntInfDtlsEl, 'OrgnlFnlColltnDt') ?? undefined
  // The raw frequency string is cast to the FrequencyCode enum; post-parse model
  // validation rejects an out-of-enum value rather than silently accepting it.
  const originalFrequency = textAt(amdmntInfDtlsEl, 'OrgnlFrqcy', 'Tp') ?? undefined
  const originalReason = extractOrgnlRsn(amdmntInfDtlsEl)
  return {
    ...(originalMandateId !== undefined ? { originalMandateId } : {}),
    ...(originalDebtorAccount !== undefined ? { originalDebtorAccount } : {}),
    ...(originalFinalCollectionDate !== undefined ? { originalFinalCollectionDate } : {}),
    ...(originalFrequency !== undefined
      ? { originalFrequency: originalFrequency as MandateAmendment['originalFrequency'] }
      : {}),
    ...(originalReason !== undefined ? { originalReason } : {}),
  }
}

/**
 * Extract a MandateAmendment from an AmdmntInfDtls element, if present.
 * Returns undefined when the element is absent or has no recognized fields.
 * Never returns an empty object, preserving round-trip deep-equality.
 *
 * Extracted fields (AmendmentInformationDetails13):
 *   OrgnlMndtId                                  -> originalMandateId
 *   OrgnlCdtrSchmeId (Nm, Id/PrvtId/Othr/Id)     -> originalCreditorSchemeId
 *   OrgnlDbtr/Nm                                 -> originalDebtor
 *   OrgnlDbtrAcct/Id/IBAN                         -> originalDebtorAccount
 *   OrgnlDbtrAgt/FinInstnId/Othr/Id = "SMNDA"     -> sameMandateNewDebtorAccount: true
 *   OrgnlDbtrAgt/FinInstnId/BICFI                 -> originalDebtorAgent
 *   OrgnlFnlColltnDt                              -> originalFinalCollectionDate
 *   OrgnlFrqcy/Tp                                 -> originalFrequency
 *   OrgnlRsn (Cd or Prtry)                        -> originalReason
 *
 * The OrgnlCdtrAgt(Acct), OrgnlDbtrAgtAcct and OrgnlTrckgDays sub-fields are not modelled and ignored.
 */
function extractMandateAmendment(amdmntInfDtlsEl: unknown): MandateAmendment | undefined {
  if (amdmntInfDtlsEl === null || amdmntInfDtlsEl === undefined) {
    return undefined
  }

  const originalCreditorSchemeId = extractOrgnlCdtrSchmeId(amdmntInfDtlsEl)
  const originalDebtorName = textAt(amdmntInfDtlsEl, 'OrgnlDbtr', 'Nm') ?? undefined

  const amd: MandateAmendment = {
    ...extractAmendmentScalarFields(amdmntInfDtlsEl),
    ...(originalCreditorSchemeId !== undefined ? { originalCreditorSchemeId } : {}),
    ...(originalDebtorName !== undefined ? { originalDebtor: { name: originalDebtorName } } : {}),
    ...extractOrgnlDbtrAgt(amdmntInfDtlsEl),
  }

  return Object.keys(amd).length === 0 ? undefined : amd
}

function extractCollection(txEl: unknown): Collection | null {
  if (!txEl || typeof txEl !== 'object') return null

  const endToEndId = textAt(txEl, 'PmtId', 'EndToEndId')
  if (!endToEndId) return null

  // InstdAmt sits directly on DrctDbtTxInf (not wrapped in Amt like pain.001).
  const amount = parseAmtElement(txEl, 'InstdAmt')
  if (!amount) return null

  // Mandate: DrctDbtTx/MndtRltdInf
  const mandateId = textAt(txEl, 'DrctDbtTx', 'MndtRltdInf', 'MndtId')
  if (!mandateId) return null
  const signatureDate = textAt(txEl, 'DrctDbtTx', 'MndtRltdInf', 'DtOfSgntr')
  if (!signatureDate) return null

  // Optional amendment: AmdmntInfDtls (only extracted when AmdmntInd=true is present)
  const amdmntInd = textAt(txEl, 'DrctDbtTx', 'MndtRltdInf', 'AmdmntInd')
  const amendment =
    amdmntInd === 'true'
      ? extractMandateAmendment(nav(txEl, 'DrctDbtTx', 'MndtRltdInf', 'AmdmntInfDtls'))
      : undefined

  const mandate: Mandate = {
    id: mandateId,
    signatureDate,
    ...(amendment !== undefined ? { amendment } : {}),
  }

  // Debtor: Dbtr + DbtrAcct + DbtrAgt
  const dbtrEl = nav(txEl, 'Dbtr')
  const dbtrName = textAt(dbtrEl, 'Nm')
  if (!dbtrName) return null
  const dbtrIban = textAt(txEl, 'DbtrAcct', 'Id', 'IBAN')
  if (!dbtrIban) return null
  // Try BICFI (modern) then fall back to BIC (legacy .02).
  const dbtrBic =
    textAt(txEl, 'DbtrAgt', 'FinInstnId', 'BICFI') ??
    textAt(txEl, 'DbtrAgt', 'FinInstnId', 'BIC') ??
    undefined
  const dbtrAddress = extractPstlAdr(dbtrEl)

  const debtor = {
    name: dbtrName,
    iban: dbtrIban,
    ...(dbtrBic !== undefined ? { bic: dbtrBic } : {}),
    ...(dbtrAddress !== undefined ? { address: dbtrAddress } : {}),
  }

  // Optional remittanceInfo. Treat empty strings as absent (defensive against empty elements).
  const ustrdRaw = textAt(txEl, 'RmtInf', 'Ustrd')
  const remittanceInfo = ustrdRaw !== null && ustrdRaw !== '' ? ustrdRaw : undefined

  // Optional structured remittance (RmtInf/Strd/CdtrRefInf). Absent when the
  // document uses unstructured remittance or no remittance at all.
  const structuredRemittance = extractStructuredRemittance(txEl)

  // Optional ultimate parties (name-only, pain.008.001.08 DirectDebitTransactionInformation23).
  const ultimateCreditor = extractUltimateParty(txEl, 'UltmtCdtr')
  const ultimateDebtor = extractUltimateParty(txEl, 'UltmtDbtr')

  // Optional transaction-level purpose (Purp, Purpose2Choice: Cd or Prtry).
  const purpose = extractPurposeChoice(nav(txEl, 'Purp'))

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

  const id = textAt(pmtInfEl, 'PmtInfId')
  if (!id) return null

  const collectionDate = textAt(pmtInfEl, 'ReqdColltnDt')
  if (!collectionDate) return null

  // Sequence type (PmtTpInf/SeqTp)
  const seqTpRaw = textAt(pmtInfEl, 'PmtTpInf', 'SeqTp')
  if (!seqTpRaw) return null
  const validSeqTypes: SequenceType[] = ['FRST', 'RCUR', 'OOFF', 'FNAL']
  if (!validSeqTypes.includes(seqTpRaw as SequenceType)) return null
  const sequenceType = seqTpRaw as SequenceType

  // Local instrument (PmtTpInf/LclInstrm/Cd) - always present in our writer
  const lclInstrmRaw = textAt(pmtInfEl, 'PmtTpInf', 'LclInstrm', 'Cd')
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

  // Optional batch-level category purpose (PmtTpInf/CtgyPurp, CategoryPurpose1Choice: Cd or Prtry).
  const categoryPurpose: CategoryPurpose | undefined = extractPurposeChoice(
    nav(pmtInfEl, 'PmtTpInf', 'CtgyPurp')
  )

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
  const name = textAt(cdtrEl, 'Nm')
  if (!name) return null

  const iban = textAt(pmtInfEl, 'CdtrAcct', 'Id', 'IBAN')
  if (!iban) return null

  // Try BICFI (modern) then fall back to BIC (legacy .02).
  const bic =
    textAt(pmtInfEl, 'CdtrAgt', 'FinInstnId', 'BICFI') ??
    textAt(pmtInfEl, 'CdtrAgt', 'FinInstnId', 'BIC') ??
    undefined

  const address = extractPstlAdr(cdtrEl)

  // CdtrSchmeId/Id/PrvtId/Othr/Id
  const creditorId = textAt(pmtInfEl, 'CdtrSchmeId', 'Id', 'PrvtId', 'Othr', 'Id')
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

function rejectUnsafeInput(xml: unknown): ParseFailure | null {
  // Runtime type guard: protects against non-string values reaching the parser
  if (typeof xml !== 'string') {
    return { ok: false, error: 'Input must be a string' }
  }

  // Reject empty or whitespace-only input before attempting to parse
  if (xml.trim() === '') {
    return { ok: false, error: 'Input is empty or whitespace only' }
  }

  // Reject DOCTYPE/DTD declarations. SEPA documents never legitimately contain a
  // DTD, and allowing them would expose the parser to XXE and entity-expansion
  // attacks via the fast-xml-parser layer.
  if (/<!DOCTYPE/i.test(xml)) {
    return { ok: false, error: 'DOCTYPE/DTD is not permitted in SEPA documents' }
  }

  const problem = findWellFormednessProblem(xml)
  if (problem !== null) {
    return { ok: false, error: `XML parse error: ${problem}` }
  }

  return null
}

/**
 * Parse a SEPA XML string, auto-detecting pain.001 or pain.008 by xmlns.
 *
 * Namespace detection: reads the xmlns attribute from the raw XML string using
 * a regex. This is more reliable than trying to extract it from the XMLParser
 * output, which may not preserve xmlns as a regular attribute.
 *
 * Character references (&#352; and &#x160;) are decoded. A document that is not
 * well-formed XML 1.0 with namespaces returns ok:false: for example a bare "&", an
 * undefined entity such as &nbsp; (there is no DTD), a reference to a code point that is
 * not a legal XML character, an end tag that does not match its start tag, "<![" outside
 * a CDATA section, or content outside the root element (src/xml-wellformedness.ts). So
 * does a processing instruction with a quote still open at its "?>", which
 * fast-xml-parser would read past, and an element or attribute name that holds a
 * character JS matches with \s (U+1680, U+FEFF), where fast-xml-parser would split it.
 *
 * Element text is read as XML reads it, trimmed of space, tab, CR and LF at both ends.
 * An element the model holds once that occurs more than once, a text element that
 * contains an element, or a text element with an attribute the model does not hold
 * (xmlns="urn:other" included) returns ok:false ("Cannot read <Ustrd>: ...").
 *
 * Text fields accept the EPC217-08 extended character set by default (see
 * ParseOptions.charset); pass { charset: 'basic' } to accept only basic Latin.
 *
 * This function never throws. All failure modes return { ok: false, error }, including
 * an unexpected internal error ("Internal parse error: ...").
 *
 * @param xml the XML string to parse
 * @param options optional parse options (charset)
 * @returns ParseResult discriminated union
 */
export function parse(xml: string, options?: ParseOptions): ParseResult {
  try {
    return parseDocument(xml, options)
  } catch (e) {
    return {
      ok: false,
      error: `Internal parse error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

function parseDocument(xml: string, options: ParseOptions | undefined): ParseResult {
  const charset = resolveParseCharset(options)
  if (typeof charset !== 'string') {
    return charset
  }

  const unsafe = rejectUnsafeInput(xml)
  if (unsafe !== null) {
    return unsafe
  }

  // Read the namespace from the root <Document> start tag only (the prolog is skipped,
  // so a fake xmlns in a comment or processing instruction cannot steer detection).
  // See src/xmlns-detect.ts.
  const ns = detectSepaNamespace(xml)

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

  dropNamespaceDeclarationsThatKeepTheNamespace(parsed, ns)
  return parseByNamespace(parsed, ns, charset)
}

const DEFAULT_NAMESPACE_ATTRIBUTE = `${ATTRIBUTE_PREFIX}xmlns`
const PREFIX_DECLARATION_PREFIX = `${ATTRIBUTE_PREFIX}xmlns:`

/**
 * Remove the namespace declarations that cannot change which element the model reads:
 * every prefix declaration (xmlns:p, already checked by the scan) and every default
 * declaration that repeats the document namespace. A default declaration of another
 * namespace stays, so a text element that carries one fails in textOf.
 */
function dropNamespaceDeclarationsThatKeepTheNamespace(node: unknown, namespace: string): void {
  if (node === null || typeof node !== 'object') return
  const fields = node as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    const keepsNamespace =
      key.startsWith(PREFIX_DECLARATION_PREFIX) ||
      (key === DEFAULT_NAMESPACE_ATTRIBUTE && fields[key] === namespace)
    if (keepsNamespace) delete fields[key]
    else dropNamespaceDeclarationsThatKeepTheNamespace(fields[key], namespace)
  }
}

function resolveParseCharset(options: ParseOptions | undefined): SepaCharset | ParseFailure {
  try {
    return resolveSepaCharset(options?.charset, SepaCharset.Extended)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function parseByNamespace(parsed: unknown, ns: string, charset: SepaCharset): ParseResult {
  // Extract a short version string from the namespace URI, e.g. "pain.001.001.09".
  const version = ns.split(':xsd:')[1] ?? ns

  try {
    if (PAIN008_NAMESPACES.has(ns)) {
      return parsePain008(parsed, version, charset)
    }

    if (PAIN001_NAMESPACES.has(ns)) {
      return parsePain001(parsed, version, charset)
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

/** The failure for an error thrown while a document is mapped to the model. */
function caughtFailure(messageType: string, e: unknown): ParseFailure {
  if (e instanceof UnreadableElementError) {
    return { ok: false, error: e.message }
  }
  return {
    ok: false,
    error: `${messageType} parse error: ${e instanceof Error ? e.message : String(e)}`,
  }
}

// ---------------------------------------------------------------------------
// Shared GrpHdr extraction: common to both parsePain001 and parsePain008
// ---------------------------------------------------------------------------

type GrpHdrExtracted = {
  ok: true
  messageId: string
  createdAt: string
  initiatingParty: string
  pmtInfArray: unknown[]
}

/**
 * Extract the common GrpHdr fields (MsgId, CreDtTm, InitgPty/Nm) and the PmtInf
 * array from a document root element. Used by both parsePain001 and parsePain008.
 *
 * Returns either the extracted values (ok: true) or a ParseFailure (ok: false).
 */
function extractGrpHdr(root: unknown): GrpHdrExtracted | ParseFailure {
  const grpHdr = nav(root, 'GrpHdr')
  if (!grpHdr) {
    return { ok: false, error: 'Missing GrpHdr element' }
  }

  const messageId = textAt(grpHdr, 'MsgId')
  if (!messageId) {
    return { ok: false, error: 'Missing GrpHdr/MsgId' }
  }

  const createdAt = textAt(grpHdr, 'CreDtTm')
  if (!createdAt) {
    return { ok: false, error: 'Missing GrpHdr/CreDtTm' }
  }

  const initiatingParty = textAt(grpHdr, 'InitgPty', 'Nm')
  if (!initiatingParty) {
    return { ok: false, error: 'Missing GrpHdr/InitgPty/Nm' }
  }

  const pmtInfArray = nav(root, 'PmtInf')
  if (!Array.isArray(pmtInfArray) || pmtInfArray.length === 0) {
    return { ok: false, error: 'Missing or empty PmtInf elements' }
  }

  return { ok: true, messageId, createdAt, initiatingParty, pmtInfArray }
}

// ---------------------------------------------------------------------------
// pain.001 sub-parser (handles pain.001.001.09 and pain.001.001.03)
// ---------------------------------------------------------------------------

function parsePain001(parsed: unknown, version: string, charset: SepaCharset): ParseResult {
  try {
    const root = nav(parsed, 'Document', 'CstmrCdtTrfInitn')
    if (!root) {
      return { ok: false, error: 'Missing Document/CstmrCdtTrfInitn element' }
    }

    const hdr = extractGrpHdr(root)
    if (!hdr.ok) return hdr
    const { messageId, createdAt, initiatingParty, pmtInfArray } = hdr

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

    const validation = creditTransferSchemasFor(charset).CreditTransferDocument.safeParse(rawDoc)
    if (!validation.success) {
      const messages = validation.error.issues
        .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
        .join('; ')
      return { ok: false, error: `Model validation failed after parse: ${messages}` }
    }

    return { ok: true, type: 'pain.001', version, data: validation.data }
  } catch (e) {
    return caughtFailure('pain.001', e)
  }
}

// ---------------------------------------------------------------------------
// pain.008 sub-parser (handles pain.008.001.08 and pain.008.001.02)
// ---------------------------------------------------------------------------

function parsePain008(parsed: unknown, version: string, charset: SepaCharset): ParseResult {
  try {
    const root = nav(parsed, 'Document', 'CstmrDrctDbtInitn')
    if (!root) {
      return { ok: false, error: 'Missing Document/CstmrDrctDbtInitn element' }
    }

    const hdr = extractGrpHdr(root)
    if (!hdr.ok) return hdr
    const { messageId, createdAt, initiatingParty, pmtInfArray } = hdr

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

    const validation = directDebitSchemasFor(charset).DirectDebitDocument.safeParse(rawDoc)
    if (!validation.success) {
      const messages = validation.error.issues
        .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
        .join('; ')
      return { ok: false, error: `Model validation failed after parse: ${messages}` }
    }

    return { ok: true, type: 'pain.008', version, data: validation.data }
  } catch (e) {
    return caughtFailure('pain.008', e)
  }
}
