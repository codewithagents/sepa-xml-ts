/**
 * Zod schema definitions for pain.001.001.09 (CustomerCreditTransferInitiation).
 *
 * The model is designed to feel natural to a developer thinking about a payment,
 * not to mirror the XSD element tree 1:1.
 *
 * Anchored on the XSD: schemas/iso20022/pain.001.001.09.xsd
 */

import { z } from 'zod'
import { isValidIso11649Ref } from './iban.js'
import { SepaCharset, type TextCharset } from './charset.js'
import { IBANSchema, BICSchema, sepaText, sepaReference, sepaIdentifier } from './shared.js'

// ---------------------------------------------------------------------------
// Internal validators (not exported from public API)
// ---------------------------------------------------------------------------

// ISO 8601 datetime pattern (ISODateTime in XSD)
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/

// ISO 8601 date pattern (ISODate in XSD, YYYY-MM-DD only, no time component)
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Purpose code (Cd): ExternalPurpose1Code and ExternalCategoryPurpose1Code.
 *
 * Both XSD types are open strings (xs:restriction base="xs:string", minLength 1, maxLength 4),
 * NOT enumerations. Validation is deliberately limited to charset and length.
 *
 * We do NOT validate against the ISO external code list (SALA, SUPP, TAXS, etc.).
 * That list is published separately by ISO and updated quarterly. Validating membership
 * would risk false-positive rejections of valid-but-newer codes, which violates our
 * "a false reject is worse than none" principle.
 *
 * Confirmed against schemas/iso20022/pain.001.001.09.xsd and pain.008.001.08.xsd:
 * ExternalPurpose1Code: minLength=1, maxLength=4 (open string)
 * ExternalCategoryPurpose1Code: minLength=1, maxLength=4 (open string)
 */
const PurposeCodeSchema = sepaReference(4)

/**
 * Proprietary purpose value (Prtry), a Max35Text open string. SEPA charset, 1..35 chars.
 * Confirmed against the XSD: Purpose2Choice/Prtry and CategoryPurpose1Choice/Prtry are
 * both typed as Max35Text.
 */
const ProprietaryPurposeSchema = z.object({
  /** Proprietary purpose value (Prtry), max 35 chars, basic Latin in every charset mode. */
  proprietary: sepaReference(35),
})

/**
 * Purpose (Purp), modelling Purpose2Choice: Cd XOR Prtry.
 *
 * The XSD is a true choice (exactly one of Cd or Prtry). To keep the 90% path
 * non-breaking, a plain string means the Cd code path (byte-identical output as
 * before), while an object { proprietary } means the Prtry path. The two shapes are
 * structurally disjoint (string vs object), so the union itself enforces "exactly one".
 */
export const PurposeSchema = z.union([PurposeCodeSchema, ProprietaryPurposeSchema])

export type Purpose = z.infer<typeof PurposeSchema>

/**
 * Category purpose (CtgyPurp), modelling CategoryPurpose1Choice: Cd XOR Prtry.
 * Same Cd-string-or-{ proprietary } convention as PurposeSchema.
 */
export const CategoryPurposeSchema = z.union([PurposeCodeSchema, ProprietaryPurposeSchema])

export type CategoryPurpose = z.infer<typeof CategoryPurposeSchema>

/** ISODateTime: full datetime string */
const ISODateTimeSchema = z
  .string()
  .regex(ISO_DATETIME_PATTERN, 'Must be a valid ISO 8601 datetime (e.g. 2024-01-15T10:00:00Z)')

/**
 * ISODate: date only, no time component.
 * ReqdExctnDt uses DateAndDateTime2Choice which wraps Dt (date) or DtTm (datetime).
 * We always emit Dt (date only) for SEPA compliance.
 */
const ISODateSchema = z
  .string()
  .regex(ISO_DATE_PATTERN, 'Must be a valid ISO 8601 date in YYYY-MM-DD format (no time component)')

// IBANSchema and BICSchema are imported from ./shared.js (identical definitions in both
// schema.ts and pain008.ts, extracted to avoid duplication).

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** Minimum allowed amount in minor units (0.01 EUR = 1 cent). EPC AT-06 floor. */
const MIN_AMOUNT_MINOR = 1n

/**
 * Maximum allowed amount in minor units. EPC AT-06 cap: 999,999,999.99 EUR.
 * That is 99,999,999,999 cents (99_999_999_999n).
 */
const MAX_AMOUNT_MINOR = 99_999_999_999n

/**
 * Money is a first-class value. SEPA is EUR-only.
 * minorUnits is the exact integer amount in cents (no float ever).
 */
export const MoneySchema = z.object({
  currencyCode: z.literal('EUR'),
  minorUnits: z
    .bigint()
    .min(MIN_AMOUNT_MINOR, 'Amount must be at least 0.01 EUR (1 cent)')
    .max(
      MAX_AMOUNT_MINOR,
      'Amount exceeds the EPC per-transaction cap of 999,999,999.99 EUR (AT-06)'
    ),
})

export type Money = z.infer<typeof MoneySchema>

/**
 * Parse a decimal string (no float input) into a Money value.
 * Accepts "123.45", "123.4", "123", "0.01".
 * Rejects: >2 decimals, non-numeric, negative, empty.
 *
 * @param amount decimal string representation of EUR amount
 * @returns Money with currencyCode "EUR" and exact minorUnits
 */
export function euros(amount: string): Money {
  if (!amount || amount.trim() === '') {
    throw new Error(`euros(): amount must not be empty`)
  }
  const trimmed = amount.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error(
      `euros(): invalid amount string "${amount}". Must be a non-negative decimal with at most 2 decimal places.`
    )
  }
  const parts = trimmed.split('.')
  const wholePart = parts[0] ?? '0'
  const fracPart = (parts[1] ?? '0').padEnd(2, '0')
  const minorUnits = BigInt(wholePart) * 100n + BigInt(fracPart)
  if (minorUnits < MIN_AMOUNT_MINOR) {
    throw new Error(`euros(): amount "${amount}" is below the minimum (0.01 EUR)`)
  }
  if (minorUnits > MAX_AMOUNT_MINOR) {
    throw new Error(
      `euros(): amount "${amount}" exceeds the EPC per-transaction cap of 999,999,999.99 EUR (AT-06)`
    )
  }
  return { currencyCode: 'EUR', minorUnits }
}

/**
 * Format a Money value to a decimal string.
 * Result always has exactly 2 decimal places, dot separator, no grouping.
 *
 * @param m the Money value to format
 * @returns string like "123.45"
 */
export function formatMoney(m: Money): string {
  if (m.minorUnits < 0n) {
    throw new Error(`formatMoney(): amount must not be negative`)
  }
  const whole = m.minorUnits / 100n
  const cents = m.minorUnits % 100n
  return `${whole}.${cents.toString().padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Party identification: structured Id for UltmtDbtr / UltmtCdtr
// ---------------------------------------------------------------------------

/**
 * AnyBIC / BIC identifier (AnyBICDec2014Identifier in the XSD).
 * Same lexical format as a BIC: 8 or 11 chars.
 */
const AnyBicSchema = z
  .string()
  .regex(/^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/, 'Invalid BIC/AnyBIC format')

/**
 * Legal Entity Identifier (LEIIdentifier in the XSD): exactly 20 chars,
 * 18 alphanumerics followed by 2 check digits.
 */
const LeiSchema = z
  .string()
  .regex(
    /^[A-Z0-9]{18}[0-9]{2}$/,
    'Invalid LEI format (expected 18 alphanumerics + 2 check digits)'
  )

/**
 * Country code (CountryCode in the XSD): exactly 2 uppercase letters.
 */
const CountryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, 'Country must be exactly 2 uppercase letters (ISO 3166-1 alpha-2)')

/**
 * A scheme-name code (SchmeNm/Cd): ExternalOrganisationIdentification1Code or
 * ExternalPersonIdentification1Code. Both are open strings in the XSD (min 1,
 * max 4), NOT enumerations, so we validate charset and length only and never
 * reject against a published code list (same rationale as purpose codes).
 */
const SchemeNameCodeSchema = sepaReference(4)

/**
 * A generic identifier (GenericOrganisationIdentification1 / GenericPersonIdentification1).
 *
 * Maps to Othr/Id (+ optional Othr/SchmeNm/Cd + optional Othr/Issr) in the XSD.
 * Used by both the organisation and private identification shapes.
 */
export const GenericIdentificationSchema = z.object({
  /** Identifier value (Othr/Id), max 35 chars, basic Latin in every charset mode. */
  id: sepaReference(35),
  /**
   * Scheme name code (Othr/SchmeNm/Cd), 1-4 char external code. Optional.
   * Emitted as Cd; proprietary scheme names (Prtry) are not modelled.
   */
  schemeName: SchemeNameCodeSchema.optional(),
  /** Issuer of the identifier (Othr/Issr), max 35 chars, basic Latin in every charset mode. Optional. */
  issuer: sepaReference(35).optional(),
})

export type GenericIdentification = z.infer<typeof GenericIdentificationSchema>

/**
 * Organisation identification (OrganisationIdentification29, the OrgId branch
 * of Party38Choice).
 *
 * At least one of bic, lei, or other must be present (an empty OrgId is
 * meaningless and not XSD-useful). The XSD element order is AnyBIC, LEI, Othr,
 * which the writer follows.
 */
export const OrganisationIdentificationSchema = z
  .object({
    /** AnyBIC / business identifier code (OrgId/AnyBIC). Optional. */
    bic: AnyBicSchema.optional(),
    /** Legal Entity Identifier (OrgId/LEI). Optional. */
    lei: LeiSchema.optional(),
    /** Generic other identifier (OrgId/Othr). Optional. */
    other: GenericIdentificationSchema.optional(),
  })
  .refine((o) => o.bic !== undefined || o.lei !== undefined || o.other !== undefined, {
    message:
      'OrganisationIdentification must set at least one of bic, lei, or other (an empty OrgId is not allowed)',
  })

export type OrganisationIdentification = z.infer<typeof OrganisationIdentificationSchema>

/**
 * Date and place of birth (DateAndPlaceOfBirth1).
 *
 * XSD element order: BirthDt, PrvcOfBirth (optional), CityOfBirth, CtryOfBirth.
 * birthDate, cityOfBirth, and countryOfBirth are required by the XSD.
 */
export const DateAndPlaceOfBirthSchema = z.object({
  /** Birth date (BirthDt), YYYY-MM-DD. */
  birthDate: ISODateSchema,
  /** Province of birth (PrvcOfBirth), max 35 chars, basic Latin in every charset mode. Optional. */
  provinceOfBirth: sepaReference(35).optional(),
  /** City of birth (CityOfBirth), max 35 chars, basic Latin in every charset mode. */
  cityOfBirth: sepaReference(35),
  /** Country of birth (CtryOfBirth), 2-letter ISO country code. */
  countryOfBirth: CountryCodeSchema,
})

export type DateAndPlaceOfBirth = z.infer<typeof DateAndPlaceOfBirthSchema>

/**
 * Private (person) identification (PersonIdentification13, the PrvtId branch
 * of Party38Choice).
 *
 * At least one of dateAndPlaceOfBirth or other must be present. The XSD element
 * order is DtAndPlcOfBirth, Othr, which the writer follows.
 */
export const PrivateIdentificationSchema = z
  .object({
    /** Date and place of birth (PrvtId/DtAndPlcOfBirth). Optional. */
    dateAndPlaceOfBirth: DateAndPlaceOfBirthSchema.optional(),
    /** Generic other identifier (PrvtId/Othr). Optional. */
    other: GenericIdentificationSchema.optional(),
  })
  .refine((p) => p.dateAndPlaceOfBirth !== undefined || p.other !== undefined, {
    message:
      'PrivateIdentification must set at least one of dateAndPlaceOfBirth or other (an empty PrvtId is not allowed)',
  })

export type PrivateIdentification = z.infer<typeof PrivateIdentificationSchema>

/**
 * Structured party identification (Party38Choice in the XSD): an organisation
 * identifier (OrgId) XOR a private identifier (PrvtId), never both.
 *
 * Modelled as a single object with two optional branches plus an exactly-one
 * refinement, rather than mirroring the XSD <choice> as a raw union, so it reads
 * naturally and the writer can branch on which key is set.
 */
export const PartyIdentificationSchema = z
  .object({
    /** Organisation identifier (Id/OrgId). Mutually exclusive with privateId. */
    organisationId: OrganisationIdentificationSchema.optional(),
    /** Private (person) identifier (Id/PrvtId). Mutually exclusive with organisationId. */
    privateId: PrivateIdentificationSchema.optional(),
  })
  .refine(
    (id) => (id.organisationId !== undefined ? 1 : 0) + (id.privateId !== undefined ? 1 : 0) === 1,
    {
      message:
        'A party identification must set exactly one of organisationId or privateId (Party38Choice is a choice of OrgId XOR PrvtId)',
    }
  )

export type PartyIdentification = z.infer<typeof PartyIdentificationSchema>

// ---------------------------------------------------------------------------
// StructuredRemittance: structured creditor reference (ISO 11649 or national)
// ---------------------------------------------------------------------------

/**
 * Reference type code (RmtInf/Strd/CdtrRefInf/Tp/CdOrPrtry/Cd), the
 * DocumentType3Code enumeration. The XSD types the Cd branch as this enum, so a
 * value outside it would emit an XSD-invalid file. "SCOR" is the SEPA structured
 * creditor reference code (the default on write when omitted).
 */
const ReferenceTypeCodeSchema = z.enum(['RADM', 'RPIN', 'FXDR', 'DISP', 'PUOR', 'SCOR'])

/**
 * Proprietary reference type value (Prtry), a Max35Text open string, SEPA charset.
 * Confirmed against the XSD: CreditorReferenceType1Choice/Prtry is typed as Max35Text.
 */
const ProprietaryReferenceTypeSchema = z.object({
  /** Proprietary reference type value (Prtry), max 35 chars, basic Latin in every charset mode. */
  proprietary: sepaReference(35),
})

/**
 * Reference type (RmtInf/Strd/CdtrRefInf/Tp/CdOrPrtry), modelling
 * CreditorReferenceType1Choice: Cd XOR Prtry.
 *
 * To keep the 90% path non-breaking, a plain string from the DocumentType3Code
 * enum is the Cd path (byte-identical output, SCOR default), while an object
 * { proprietary } is the Prtry path. The two shapes are structurally disjoint
 * (string vs object), so the union itself enforces "exactly one".
 */
export const ReferenceTypeSchema = z.union([
  ReferenceTypeCodeSchema,
  ProprietaryReferenceTypeSchema,
])

export type ReferenceType = z.infer<typeof ReferenceTypeSchema>

/**
 * Document type code for a referred document (RfrdDocInf/Tp/CdOrPrtry/Cd), the
 * DocumentType6Code enumeration. The XSD types the Cd branch as this enum.
 */
const DocumentTypeCodeSchema = z.enum([
  'MSIN',
  'CNFA',
  'DNFA',
  'CINV',
  'CREN',
  'DEBN',
  'HIRI',
  'SBIN',
  'CMCN',
  'SOAC',
  'DISP',
  'BOLD',
  'VCHR',
  'AROI',
  'TSUT',
  'PUOR',
])

/**
 * Referred-document type (RfrdDocInf/Tp/CdOrPrtry), modelling
 * ReferredDocumentType3Choice: Cd XOR Prtry. A plain string from the
 * DocumentType6Code enum is the Cd path; an object { proprietary } is the
 * Prtry path (Max35Text). The union enforces "exactly one".
 */
export const DocumentTypeSchema = z.union([DocumentTypeCodeSchema, ProprietaryReferenceTypeSchema])

export type DocumentType = z.infer<typeof DocumentTypeSchema>

/**
 * A referred document (RmtInf/Strd/RfrdDocInf), modelling
 * ReferredDocumentInformation7. Repeatable (an array on the parent).
 *
 * Models the common fields: document type (Tp), document number (Nb), and the
 * related date (RltdDt). The richer LineDtls sub-element is a documented
 * follow-up. At least one field must be present, since an empty RfrdDocInf
 * carries no information.
 */
export const ReferredDocumentSchema = z
  .object({
    /** Document type (RfrdDocInf/Tp/CdOrPrtry): a DocumentType6Code string XOR { proprietary }. */
    type: DocumentTypeSchema.optional(),
    /** Document number (RfrdDocInf/Nb), max 35 chars, basic Latin in every charset mode. */
    number: sepaReference(35).optional(),
    /** Related date (RfrdDocInf/RltdDt), YYYY-MM-DD. */
    relatedDate: ISODateSchema.optional(),
  })
  .refine((d) => d.type !== undefined || d.number !== undefined || d.relatedDate !== undefined, {
    message:
      'A referred document must set at least one of type, number, or relatedDate (an empty RfrdDocInf carries no information)',
  })

export type ReferredDocument = z.infer<typeof ReferredDocumentSchema>

/**
 * Referred-document amounts (RmtInf/Strd/RfrdDocAmt), modelling RemittanceAmount2.
 *
 * These are INFORMATIONAL sub-amounts about the referenced document, not the
 * transaction's InstdAmt: they never affect CtrlSum or the transferred amount.
 * Each is an EUR Money value emitted with Ccy="EUR" and the usual 2-decimal rules.
 *
 * First cut supports the three plain ActiveOrHistoricCurrencyAndAmount fields:
 * DuePyblAmt, CdtNoteAmt, RmtdAmt. The typed sub-amounts (DscntApldAmt, TaxAmt,
 * AdjstmntAmtAndRsn) are a documented follow-up. At least one amount must be set.
 */
export const RemittanceAmountSchema = z
  .object({
    /** Amount due and payable (RfrdDocAmt/DuePyblAmt), EUR Money. */
    duePayableAmount: MoneySchema.optional(),
    /** Credit note amount (RfrdDocAmt/CdtNoteAmt), EUR Money. */
    creditNoteAmount: MoneySchema.optional(),
    /** Remitted amount (RfrdDocAmt/RmtdAmt), EUR Money. */
    remittedAmount: MoneySchema.optional(),
  })
  .refine(
    (a) =>
      a.duePayableAmount !== undefined ||
      a.creditNoteAmount !== undefined ||
      a.remittedAmount !== undefined,
    {
      message:
        'A referred-document amount must set at least one of duePayableAmount, creditNoteAmount, or remittedAmount (an empty RfrdDocAmt carries no information)',
    }
  )

export type RemittanceAmount = z.infer<typeof RemittanceAmountSchema>

/**
 * Structured remittance information (RmtInf/Strd, StructuredRemittanceInformation16).
 *
 * Supported for pain.001.001.09 and pain.008.001.08 ONLY. Legacy and DK
 * variants will throw a clear error if this field is present.
 *
 * Carries any combination of:
 *   referredDocuments    -> RfrdDocInf (0..n)
 *   referredDocumentAmount -> RfrdDocAmt (0..1)
 *   creditorReference (+ referenceType, issuer) -> CdtrRefInf (0..1)
 *
 * At least one of those must be present: an empty Strd carries no information.
 *
 * Conditional ISO 11649 check: if creditorReference (trimmed) starts with "RF"
 * (uppercase), its check digits are validated using ISO 7064 MOD 97-10. This
 * catches definitively-broken RF references while passing through legitimate
 * national or proprietary references that do not use the RF prefix.
 *
 * Mutually exclusive with remittanceInfo (unstructured Ustrd). Having neither
 * is fine; having exactly one is required by the SEPA rulebook.
 */
export const StructuredRemittanceSchema = z
  .object({
    /**
     * Referred documents (RmtInf/Strd/RfrdDocInf), repeatable. Each carries the
     * common document type, number, and related-date fields. Optional.
     */
    referredDocuments: z.array(ReferredDocumentSchema).min(1).optional(),
    /**
     * Referred-document amounts (RmtInf/Strd/RfrdDocAmt). Informational EUR
     * sub-amounts about the referenced document; they never affect CtrlSum. Optional.
     */
    referredDocumentAmount: RemittanceAmountSchema.optional(),
    /**
     * Creditor reference (RmtInf/Strd/CdtrRefInf/Ref), max 35 chars, basic Latin in every charset mode.
     * If the trimmed value starts with "RF" (uppercase), ISO 11649 check digits
     * are validated. All other values pass through without check-digit validation.
     * Optional: structured remittance may carry only RfrdDocInf / RfrdDocAmt.
     */
    creditorReference: sepaReference(35)
      .refine(
        (v) => {
          // Only validate check digits for ISO 11649 RF references.
          if (v.trimStart().startsWith('RF')) {
            return isValidIso11649Ref(v.trim())
          }
          return true
        },
        {
          message:
            'Creditor reference starting with "RF" must have valid ISO 11649 check digits (MOD 97-10)',
        }
      )
      .optional(),
    /**
     * Reference type (RmtInf/Strd/CdtrRefInf/Tp/CdOrPrtry), CreditorReferenceType1Choice.
     * A plain DocumentType3Code string is the Cd path (defaults to "SCOR" on write);
     * an object { proprietary } is the Prtry path (Max35Text). Only meaningful with
     * creditorReference (the whole CdtrRefInf is emitted only when a reference is set).
     */
    referenceType: ReferenceTypeSchema.optional(),
    /**
     * Issuer of the reference type (RmtInf/Strd/CdtrRefInf/Tp/Issr).
     * Emitted only when present. Max 35 chars, basic Latin in every charset mode.
     */
    issuer: sepaReference(35).optional(),
  })
  .refine(
    (s) =>
      (s.referredDocuments !== undefined && s.referredDocuments.length > 0) ||
      s.referredDocumentAmount !== undefined ||
      s.creditorReference !== undefined,
    {
      message:
        'Structured remittance must carry at least one of referredDocuments, referredDocumentAmount, or creditorReference (an empty Strd carries no information)',
    }
  )
  .refine((s) => s.creditorReference !== undefined || s.referenceType === undefined, {
    message:
      'referenceType requires creditorReference: the reference type (CdtrRefInf/Tp) is only emitted when a creditor reference is present',
  })
  .refine((s) => s.creditorReference !== undefined || s.issuer === undefined, {
    message:
      'issuer requires creditorReference: the reference issuer (CdtrRefInf/Tp/Issr) is only emitted when a creditor reference is present',
  })

export type StructuredRemittance = z.infer<typeof StructuredRemittanceSchema>

// ---------------------------------------------------------------------------
// Text-bearing schemas, built per charset
//
// Human-readable text fields (names, addresses, remittance information) follow the
// charset option; every other string field is basic Latin in every mode (sepaReference,
// sepaIdentifier). The exported schemas below are the basic instances.
// ---------------------------------------------------------------------------

function buildCreditTransferSchemas(charset: TextCharset) {
  const PostalAddress = z
    .object({
      /** Street name (StrtNm), max 70 chars, text charset. */
      streetName: sepaText(70, charset).optional(),
      /** Building number (BldgNb), max 16 chars, text charset. */
      buildingNumber: sepaText(16, charset).optional(),
      /** Post code (PstCd), max 16 chars, text charset. */
      postCode: sepaText(16, charset).optional(),
      /** Town name (TwnNm), max 35 chars, text charset. */
      townName: sepaText(35, charset).optional(),
      /** Country sub-division (CtrySubDvsn), max 35 chars, text charset. */
      countrySubDivision: sepaText(35, charset).optional(),
      /** Country code (Ctry), exactly 2 uppercase letters (ISO 3166-1 alpha-2). */
      country: z
        .string()
        .regex(/^[A-Z]{2}$/, 'Country must be exactly 2 uppercase letters (ISO 3166-1 alpha-2)')
        .optional(),
      /** Address lines (AdrLine), max 7 entries, each max 70 chars, text charset. */
      addressLines: z.array(sepaText(70, charset)).max(7).optional(),
    })
    .refine(
      (a) => {
        // At least one field must be set when the address object is present.
        return (
          a.streetName !== undefined ||
          a.buildingNumber !== undefined ||
          a.postCode !== undefined ||
          a.townName !== undefined ||
          a.countrySubDivision !== undefined ||
          a.country !== undefined ||
          (a.addressLines !== undefined && a.addressLines.length > 0)
        )
      },
      {
        message:
          'PostalAddress must have at least one field set (empty address object is not allowed)',
      }
    )

  const UltimateParty = z.object({
    /** Party name (max 70 chars, text charset). */
    name: sepaText(70, charset),
    /**
     * Structured party identification (Id), optional. Party38Choice: an
     * organisation id (OrgId) XOR a private id (PrvtId). Emitted after Nm,
     * matching PartyIdentification135 element order.
     */
    id: PartyIdentificationSchema.optional(),
  })

  /**
   * A party (debtor or creditor) tied to a bank account.
   * Groups name, IBAN, optional BIC, and optional structured postal address.
   */
  const AccountParty = z.object({
    /** Party name (max 70 chars, text charset). */
    name: sepaText(70, charset),
    /** IBAN of the account (mod-97 validated). */
    iban: IBANSchema,
    /** BIC of the party's bank. Optional; validated when present. */
    bic: BICSchema.optional(),
    /**
     * Structured postal address (PstlAdr), optional.
     * Emitted for pain.001.001.09 and pain.008.001.08 only.
     * Throws a clear error for legacy/DK variants.
     * EPC mandates this from 2026-11-22.
     */
    address: PostalAddress.optional(),
  })

  /** One credit transfer transaction (maps to CdtTrfTxInf). */
  const Transfer = z
    .object({
      /** End-to-end identifier (PmtId/EndToEndId), max 35 chars, basic Latin, EPC slash rules. */
      endToEndId: sepaIdentifier(35),
      /** Amount: a Money value (euros helper recommended). */
      amount: MoneySchema,
      /**
       * Ultimate debtor (UltmtDbtr): the party on whose behalf the transfer is initiated.
       * Optional. Supported for pain.001.001.09 only. Name only in this version (max 70 chars).
       */
      ultimateDebtor: UltimateParty.optional(),
      /** Creditor party (Cdtr + CdtrAcct/IBAN + CdtrAgt/BIC). */
      creditor: AccountParty,
      /**
       * Ultimate creditor (UltmtCdtr): the party that ultimately receives the funds.
       * Optional. Supported for pain.001.001.09 only. Name only in this version (max 70 chars).
       */
      ultimateCreditor: UltimateParty.optional(),
      /** Remittance information / payment purpose (RmtInf/Ustrd), max 140 chars, text charset. Optional. */
      remittanceInfo: sepaText(140, charset).optional(),
      /**
       * Structured remittance information (RmtInf/Strd/CdtrRefInf).
       * Mutually exclusive with remittanceInfo. Supported for pain.001.001.09 ONLY.
       * Legacy and DK variants throw if this field is set.
       */
      structuredRemittance: StructuredRemittanceSchema.optional(),
      /**
       * Transaction-level purpose (CdtTrfTxInf/Purp), Purpose2Choice (Cd XOR Prtry).
       * A plain string is the Cd code path (ExternalPurpose1Code, open string, 1-4 chars,
       * not validated against the ISO external list). An object { proprietary } is the
       * Prtry path (Max35Text). Common Cd values: SALA, SUPP, TAXS, GDDS.
       * Supported for pain.001.001.09 ONLY. Legacy and DK variants throw if this is set.
       */
      purpose: PurposeSchema.optional(),
    })
    .refine((tx) => !(tx.remittanceInfo !== undefined && tx.structuredRemittance !== undefined), {
      message:
        'A transfer must not have both remittanceInfo (unstructured) and structuredRemittance (structured) set: the SEPA rulebook allows only one form of remittance information per transaction',
    })

  /** A batch of transfers debited from one account on one date (maps to PmtInf). */
  const PaymentBatch = z
    .object({
      /** Payment information identifier (PmtInfId), max 35 chars, basic Latin, EPC slash rules. */
      id: sepaIdentifier(35),
      /** Requested execution date (ReqdExctnDt), YYYY-MM-DD. Emitted as Dt (not DtTm). */
      executionDate: ISODateSchema,
      /** Debtor party (Dbtr + DbtrAcct/IBAN + DbtrAgt/BIC). */
      debtor: AccountParty,
      /**
       * Batch-level category purpose (PmtTpInf/CtgyPurp), CategoryPurpose1Choice (Cd XOR Prtry).
       * A plain string is the Cd code path (ExternalCategoryPurpose1Code, open string, 1-4 chars,
       * not validated against the ISO external list). An object { proprietary } is the Prtry path
       * (Max35Text). Common Cd values: SALA, SUPP, CASH, SECU.
       * Supported for pain.001.001.09 ONLY. Legacy and DK variants throw if this is set.
       */
      categoryPurpose: CategoryPurposeSchema.optional(),
      /** Credit transfers in this batch. At least one required. */
      transfers: z.array(Transfer).min(1),
    })
    .refine((b) => b.transfers.length > 0, {
      message: 'PaymentBatch must contain at least one transfer',
    })

  const CreditTransferDocument = z
    .object({
      /** Message ID (GrpHdr/MsgId), max 35 chars, basic Latin, EPC slash rules. */
      messageId: sepaIdentifier(35),
      /** Creation date-time (GrpHdr/CreDtTm), ISO 8601 datetime. */
      createdAt: ISODateTimeSchema,
      /** Initiating party name (GrpHdr/InitgPty/Nm), max 70 chars, text charset. */
      initiatingParty: sepaText(70, charset),
      /** Payment batches (PmtInf). At least one required. */
      batches: z.array(PaymentBatch).min(1),
    })
    .refine(
      (doc) => {
        const totalTxs = doc.batches.reduce((sum, batch) => sum + batch.transfers.length, 0)
        return totalTxs >= 1
      },
      { message: 'Document must contain at least one transfer' }
    )

  return {
    PostalAddress,
    UltimateParty,
    AccountParty,
    Transfer,
    PaymentBatch,
    CreditTransferDocument,
  }
}

type CreditTransferSchemas = ReturnType<typeof buildCreditTransferSchemas>

const BASIC_CREDIT_TRANSFER_SCHEMAS = buildCreditTransferSchemas(SepaCharset.Basic)
const creditTransferSchemasByCharset = new Map<TextCharset, CreditTransferSchemas>([
  [SepaCharset.Basic, BASIC_CREDIT_TRANSFER_SCHEMAS],
])

/**
 * The text-bearing pain.001 schemas for a text charset. The basic set is the exported
 * schemas; the others are built on first use.
 */
export function creditTransferSchemasFor(charset: TextCharset): CreditTransferSchemas {
  let schemas = creditTransferSchemasByCharset.get(charset)
  if (schemas === undefined) {
    schemas = buildCreditTransferSchemas(charset)
    creditTransferSchemasByCharset.set(charset, schemas)
  }
  return schemas
}

/**
 * Structured postal address, mapping to PostalAddress24 in the ISO 20022 XSD.
 *
 * All fields are optional; at least one must be present when the address object
 * itself is included. EPC mandates a structured address for pain.001.001.09 and
 * pain.008.001.08 from 2026-11-22.
 *
 * Field names mirror PostalAddress24 semantics; max lengths match the XSD constraints.
 * The fields are text fields: basic Latin by default, the EPC217-08 extended set with
 * { charset: 'extended' }.
 *
 * Supported for pain.001.001.09 and pain.008.001.08 ONLY. Legacy and DK variants
 * will throw a clear error if an address is present in the model.
 */
export const PostalAddressSchema = BASIC_CREDIT_TRANSFER_SCHEMAS.PostalAddress

export type PostalAddress = z.infer<typeof PostalAddressSchema>

/**
 * An ultimate party (UltmtDbtr or UltmtCdtr): identifies the party on whose
 * behalf a payment is ultimately made or received (common in factoring and
 * payment-service-provider flows).
 *
 * Carries a name (max 70 chars, a text field) and an optional structured
 * identifier (Id, Party38Choice: OrgId XOR PrvtId, basic Latin). Name-only is always
 * XSD-valid and remains the common case; the id is purely additive and absent
 * by default.
 *
 * Supported for pain.001.001.09 and pain.008.001.08 ONLY. Legacy and DK
 * variants will throw a clear error if an ultimate party is present.
 */
export const UltimatePartySchema = BASIC_CREDIT_TRANSFER_SCHEMAS.UltimateParty

export type UltimateParty = z.infer<typeof UltimatePartySchema>

export type AccountParty = z.infer<typeof BASIC_CREDIT_TRANSFER_SCHEMAS.AccountParty>

export type Transfer = z.infer<typeof BASIC_CREDIT_TRANSFER_SCHEMAS.Transfer>

export type PaymentBatch = z.infer<typeof BASIC_CREDIT_TRANSFER_SCHEMAS.PaymentBatch>

/**
 * The top-level document model for pain.001.001.09.
 *
 * NbOfTxs and CtrlSum are DERIVED by the writer (exact bigint arithmetic),
 * so they are NOT part of this model.
 */
export const CreditTransferDocumentSchema = BASIC_CREDIT_TRANSFER_SCHEMAS.CreditTransferDocument

export type CreditTransferDocument = z.infer<typeof CreditTransferDocumentSchema>
