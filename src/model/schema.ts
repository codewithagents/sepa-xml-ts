/**
 * Zod schema definitions for pain.001.001.09 (CustomerCreditTransferInitiation).
 *
 * The model is designed to feel natural to a developer thinking about a payment,
 * not to mirror the XSD element tree 1:1.
 *
 * Anchored on the XSD: schemas/iso20022/pain.001.001.09.xsd
 */

import { z } from 'zod'
import { isValidIban, isValidIso11649Ref } from './iban.js'
import { isSepaCharset } from './charset.js'

// ---------------------------------------------------------------------------
// Internal validators (not exported from public API)
// ---------------------------------------------------------------------------

// ISO 8601 datetime pattern (ISODateTime in XSD)
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/

// ISO 8601 date pattern (ISODate in XSD, YYYY-MM-DD only, no time component)
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * A SEPA name or text field: max N chars, SEPA charset.
 */
function sepaText(maxLen: number) {
  return z
    .string()
    .min(1)
    .max(maxLen)
    .refine((v) => isSepaCharset(v), {
      message: `Value contains characters outside the SEPA charset (EPC217-08): allowed are a-z A-Z 0-9 space / - ? : ( ) . , ' +`,
    })
}

/**
 * A SEPA identifier field (MsgId, PmtInfId, EndToEndId): SEPA charset PLUS
 * EPC slash rules: must not start or end with '/', must not contain '//'.
 * Scoped to identifier elements per the EPC rulebook. Party names and mandate
 * ids are NOT subject to this rule.
 */
function sepaIdentifier(maxLen: number) {
  return sepaText(maxLen)
    .refine((v) => !v.startsWith('/'), {
      message: 'Identifier must not start with a slash (EPC slash rule)',
    })
    .refine((v) => !v.endsWith('/'), {
      message: 'Identifier must not end with a slash (EPC slash rule)',
    })
    .refine((v) => !v.includes('//'), {
      message: 'Identifier must not contain consecutive slashes (EPC slash rule)',
    })
}

/** Max140Text with SEPA charset validation */
const SepaMax140Text = sepaText(140)

/**
 * Purpose code: ExternalPurpose1Code and ExternalCategoryPurpose1Code.
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
const PurposeCodeSchema = sepaText(4)

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

/** IBAN validated by mod-97 checksum. */
const IBANSchema = z
  .string()
  .regex(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/, 'Invalid IBAN format')
  .refine((v) => isValidIban(v), {
    message: 'IBAN failed mod-97 checksum validation',
  })

/** BIC/SWIFT identifier (optional). */
const BICSchema = z
  .string()
  .regex(/^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/, 'Invalid BIC/SWIFT format')

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
// PostalAddress: structured postal address (PostalAddress24 in XSD)
// ---------------------------------------------------------------------------

/**
 * Structured postal address, mapping to PostalAddress24 in the ISO 20022 XSD.
 *
 * All fields are optional; at least one must be present when the address object
 * itself is included. EPC mandates a structured address for pain.001.001.09 and
 * pain.008.001.08 from 2026-11-22.
 *
 * Field names mirror PostalAddress24 semantics; max lengths and character set
 * match the XSD constraints (SEPA charset, EPC217-08).
 *
 * Supported for pain.001.001.09 and pain.008.001.08 ONLY. Legacy and DK variants
 * will throw a clear error if an address is present in the model.
 */
export const PostalAddressSchema = z
  .object({
    /** Street name (StrtNm), max 70 chars, SEPA charset. */
    streetName: sepaText(70).optional(),
    /** Building number (BldgNb), max 16 chars, SEPA charset. */
    buildingNumber: sepaText(16).optional(),
    /** Post code (PstCd), max 16 chars, SEPA charset. */
    postCode: sepaText(16).optional(),
    /** Town name (TwnNm), max 35 chars, SEPA charset. */
    townName: sepaText(35).optional(),
    /** Country sub-division (CtrySubDvsn), max 35 chars, SEPA charset. */
    countrySubDivision: sepaText(35).optional(),
    /** Country code (Ctry), exactly 2 uppercase letters (ISO 3166-1 alpha-2). */
    country: z
      .string()
      .regex(/^[A-Z]{2}$/, 'Country must be exactly 2 uppercase letters (ISO 3166-1 alpha-2)')
      .optional(),
    /** Address lines (AdrLine), max 7 entries, each max 70 chars, SEPA charset. */
    addressLines: z.array(sepaText(70)).max(7).optional(),
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

export type PostalAddress = z.infer<typeof PostalAddressSchema>

// ---------------------------------------------------------------------------
// UltimateParty: name-only party for UltmtDbtr / UltmtCdtr
// ---------------------------------------------------------------------------

/**
 * An ultimate party (UltmtDbtr or UltmtCdtr): identifies the party on whose
 * behalf a payment is ultimately made or received (common in factoring and
 * payment-service-provider flows).
 *
 * Name-only in this version (max 70 chars, SEPA charset). The XSD allows an
 * Id sub-element as well, but name-only is always XSD-valid and covers the
 * common case. Id extension is a follow-up.
 *
 * Supported for pain.001.001.09 and pain.008.001.08 ONLY. Legacy and DK
 * variants will throw a clear error if an ultimate party is present.
 */
export const UltimatePartySchema = z.object({
  /** Party name (max 70 chars, SEPA charset). */
  name: sepaText(70),
})

export type UltimateParty = z.infer<typeof UltimatePartySchema>

// ---------------------------------------------------------------------------
// AccountParty: a party tied to a bank account
// ---------------------------------------------------------------------------

/**
 * A party (debtor or creditor) tied to a bank account.
 * Groups name, IBAN, optional BIC, and optional structured postal address.
 */
const AccountPartySchema = z.object({
  /** Party name (max 70 chars, SEPA charset). */
  name: sepaText(70),
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
  address: PostalAddressSchema.optional(),
})

export type AccountParty = z.infer<typeof AccountPartySchema>

// ---------------------------------------------------------------------------
// StructuredRemittance: structured creditor reference (ISO 11649 or national)
// ---------------------------------------------------------------------------

/**
 * Structured remittance information with a creditor reference.
 *
 * Maps to RmtInf/Strd/CdtrRefInf in the XML output.
 *
 * Supported for pain.001.001.09 and pain.008.001.08 ONLY. Legacy and DK
 * variants will throw a clear error if this field is present.
 *
 * Conditional ISO 11649 check: if creditorReference (trimmed) starts with "RF"
 * (uppercase), its check digits are validated using ISO 7064 MOD 97-10. This
 * catches definitively-broken RF references while passing through legitimate
 * national or proprietary references that do not use the RF prefix.
 *
 * Mutually exclusive with remittanceInfo (unstructured Ustrd). Having neither
 * is fine; having exactly one is required by the SEPA rulebook.
 */
export const StructuredRemittanceSchema = z.object({
  /**
   * Creditor reference (RmtInf/Strd/CdtrRefInf/Ref), max 35 chars, SEPA charset.
   * If the trimmed value starts with "RF" (uppercase), ISO 11649 check digits
   * are validated. All other values pass through without check-digit validation.
   */
  creditorReference: sepaText(35).refine(
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
  ),
  /**
   * Reference type code (RmtInf/Strd/CdtrRefInf/Tp/CdOrPrtry/Cd).
   *
   * Constrained to the ISO 20022 DocumentType3Code enumeration, because the XSD
   * types this element as that enum: any other value would produce an
   * XSD-invalid file. For a SEPA structured creditor reference this is "SCOR"
   * (the default on write when omitted). Proprietary (Prtry) reference types
   * are not yet modelled.
   */
  referenceType: z.enum(['RADM', 'RPIN', 'FXDR', 'DISP', 'PUOR', 'SCOR']).optional(),
  /**
   * Issuer of the reference type (RmtInf/Strd/CdtrRefInf/Tp/Issr).
   * Emitted only when present. Max 35 chars, SEPA charset.
   */
  issuer: sepaText(35).optional(),
})

export type StructuredRemittance = z.infer<typeof StructuredRemittanceSchema>

// ---------------------------------------------------------------------------
// Transfer: one credit transfer transaction
// ---------------------------------------------------------------------------

/**
 * One credit transfer transaction (maps to CdtTrfTxInf).
 */
const TransferSchema = z
  .object({
    /** End-to-end identifier (PmtId/EndToEndId), max 35 chars, SEPA charset, EPC slash rules. */
    endToEndId: sepaIdentifier(35),
    /** Amount: a Money value (euros helper recommended). */
    amount: MoneySchema,
    /**
     * Ultimate debtor (UltmtDbtr): the party on whose behalf the transfer is initiated.
     * Optional. Supported for pain.001.001.09 only. Name only in this version (max 70 chars).
     */
    ultimateDebtor: UltimatePartySchema.optional(),
    /** Creditor party (Cdtr + CdtrAcct/IBAN + CdtrAgt/BIC). */
    creditor: AccountPartySchema,
    /**
     * Ultimate creditor (UltmtCdtr): the party that ultimately receives the funds.
     * Optional. Supported for pain.001.001.09 only. Name only in this version (max 70 chars).
     */
    ultimateCreditor: UltimatePartySchema.optional(),
    /** Remittance information / payment purpose (RmtInf/Ustrd), max 140 chars, SEPA charset. Optional. */
    remittanceInfo: SepaMax140Text.optional(),
    /**
     * Structured remittance information (RmtInf/Strd/CdtrRefInf).
     * Mutually exclusive with remittanceInfo. Supported for pain.001.001.09 ONLY.
     * Legacy and DK variants throw if this field is set.
     */
    structuredRemittance: StructuredRemittanceSchema.optional(),
    /**
     * Transaction-level purpose code (CdtTrfTxInf/Purp/Cd).
     * Maps to ExternalPurpose1Code in the XSD (open string, minLength 1, maxLength 4).
     * Common values: SALA (salary), SUPP (supplier payment), TAXS (tax), GDDS (goods).
     * The code list is NOT validated against the ISO external list; only charset and
     * length are checked, to avoid false-positive rejections of valid newer codes.
     * Supported for pain.001.001.09 ONLY. Legacy and DK variants throw if this is set.
     */
    purpose: PurposeCodeSchema.optional(),
  })
  .refine((tx) => !(tx.remittanceInfo !== undefined && tx.structuredRemittance !== undefined), {
    message:
      'A transfer must not have both remittanceInfo (unstructured) and structuredRemittance (structured) set: the SEPA rulebook allows only one form of remittance information per transaction',
  })

export type Transfer = z.infer<typeof TransferSchema>

// ---------------------------------------------------------------------------
// PaymentBatch: one debit account on one execution date
// ---------------------------------------------------------------------------

/**
 * A batch of transfers debited from one account on one date (maps to PmtInf).
 */
const PaymentBatchSchema = z
  .object({
    /** Payment information identifier (PmtInfId), max 35 chars, SEPA charset, EPC slash rules. */
    id: sepaIdentifier(35),
    /** Requested execution date (ReqdExctnDt), YYYY-MM-DD. Emitted as Dt (not DtTm). */
    executionDate: ISODateSchema,
    /** Debtor party (Dbtr + DbtrAcct/IBAN + DbtrAgt/BIC). */
    debtor: AccountPartySchema,
    /**
     * Batch-level category purpose code (PmtTpInf/CtgyPurp/Cd).
     * Maps to ExternalCategoryPurpose1Code in the XSD (open string, minLength 1, maxLength 4).
     * Common values: SALA (salary), SUPP (supplier payment), CASH (cash management), SECU (securities).
     * The code list is NOT validated against the ISO external list; only charset and
     * length are checked, to avoid false-positive rejections of valid newer codes.
     * Supported for pain.001.001.09 ONLY. Legacy and DK variants throw if this is set.
     */
    categoryPurpose: PurposeCodeSchema.optional(),
    /** Credit transfers in this batch. At least one required. */
    transfers: z.array(TransferSchema).min(1),
  })
  .refine((b) => b.transfers.length > 0, {
    message: 'PaymentBatch must contain at least one transfer',
  })

export type PaymentBatch = z.infer<typeof PaymentBatchSchema>

// ---------------------------------------------------------------------------
// CreditTransferDocument: the whole document
// ---------------------------------------------------------------------------

/**
 * The top-level document model for pain.001.001.09.
 *
 * NbOfTxs and CtrlSum are DERIVED by the writer (exact bigint arithmetic),
 * so they are NOT part of this model.
 */
export const CreditTransferDocumentSchema = z
  .object({
    /** Message ID (GrpHdr/MsgId), max 35 chars, SEPA charset, EPC slash rules. */
    messageId: sepaIdentifier(35),
    /** Creation date-time (GrpHdr/CreDtTm), ISO 8601 datetime. */
    createdAt: ISODateTimeSchema,
    /** Initiating party name (GrpHdr/InitgPty/Nm), max 70 chars, SEPA charset. */
    initiatingParty: sepaText(70),
    /** Payment batches (PmtInf). At least one required. */
    batches: z.array(PaymentBatchSchema).min(1),
  })
  .refine(
    (doc) => {
      const totalTxs = doc.batches.reduce((sum, batch) => sum + batch.transfers.length, 0)
      return totalTxs >= 1
    },
    { message: 'Document must contain at least one transfer' }
  )

export type CreditTransferDocument = z.infer<typeof CreditTransferDocumentSchema>
