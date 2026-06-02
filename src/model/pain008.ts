/**
 * Zod schema definitions for pain.008.001.08 (CustomerDirectDebitInitiation).
 *
 * Direct debit is the reverse of credit transfer: one creditor collects money
 * from many debtors, each authorized by a signed mandate.
 *
 * Anchored on the XSD: schemas/iso20022/pain.008.001.08.xsd
 * Namespace: urn:iso:std:iso:20022:tech:xsd:pain.008.001.08
 */

import { z } from 'zod'
import { isValidIban } from './iban.js'
import { isSepaCharset } from './charset.js'
import {
  MoneySchema,
  PostalAddressSchema,
  UltimatePartySchema,
  StructuredRemittanceSchema,
  PurposeSchema,
  CategoryPurposeSchema,
} from './schema.js'
import { isValidCreditorId } from './creditor-id.js'

// ---------------------------------------------------------------------------
// Internal validators (shared with pain001 but redefined for independence)
// ---------------------------------------------------------------------------

const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function sepaText(maxLen: number) {
  return z
    .string()
    .min(1)
    .max(maxLen)
    .refine((v) => isSepaCharset(v), {
      message: `Value contains characters outside the SEPA charset (EPC217-08)`,
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

const SepaMax35Text = sepaText(35)
const SepaMax140Text = sepaText(140)

const ISODateTimeSchema = z
  .string()
  .regex(ISO_DATETIME_PATTERN, 'Must be a valid ISO 8601 datetime')

const ISODateSchema = z
  .string()
  .regex(ISO_DATE_PATTERN, 'Must be a valid ISO 8601 date in YYYY-MM-DD format')

const IBANSchema = z
  .string()
  .regex(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/, 'Invalid IBAN format')
  .refine((v) => isValidIban(v), {
    message: 'IBAN failed mod-97 checksum validation',
  })

const BICSchema = z
  .string()
  .regex(/^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/, 'Invalid BIC/SWIFT format')

// ---------------------------------------------------------------------------
// SequenceType: SEPA direct debit sequence types
// ---------------------------------------------------------------------------

/**
 * SEPA direct debit sequence type (PmtTpInf/SeqTp).
 * FRST: First collection. RCUR: Recurring. OOFF: One-off. FNAL: Final.
 */
export const SequenceTypeSchema = z.enum(['FRST', 'RCUR', 'OOFF', 'FNAL'])
export type SequenceType = z.infer<typeof SequenceTypeSchema>

/**
 * SEPA local instrument code (PmtTpInf/LclInstrm/Cd).
 * CORE: standard SEPA Core Direct Debit. B2B: SEPA Business-to-Business Direct Debit.
 */
export const LocalInstrumentSchema = z.enum(['CORE', 'B2B'])
export type LocalInstrument = z.infer<typeof LocalInstrumentSchema>

// ---------------------------------------------------------------------------
// Creditor: the party collecting funds
// ---------------------------------------------------------------------------

/**
 * Validates a SEPA Creditor Identifier (creditorId) by format and ISO 7064 MOD 97-10 check digit.
 * Format: 2-letter country code + 2 check digits + 3-char creditor business code + 1..28 alphanumeric chars.
 * Total max 35 chars.
 * The check digit covers: nationalId + countryCode + checkDigits (business code excluded per spec).
 */
const CreditorIdSchema = z
  .string()
  .min(1)
  .max(35)
  .regex(
    /^[A-Z]{2}[0-9]{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/,
    'Invalid SEPA Creditor Identifier format (expected: CC + 2 digits + 3 char business code + identifier)'
  )
  .refine((v) => isValidCreditorId(v), {
    message: 'SEPA Creditor Identifier failed ISO 7064 MOD 97-10 check digit validation',
  })
  .refine(
    (v) => {
      // German creditor identifiers are exactly 18 characters:
      // 2 (country DE) + 2 (check digits) + 3 (business code) + 11 (national identifier).
      // This matches the Bundesbank specification for DE creditor IDs.
      const cc = v.slice(0, 2).toUpperCase()
      if (cc === 'DE') {
        return v.length === 18
      }
      return true
    },
    {
      message:
        'German (DE) SEPA Creditor Identifier must be exactly 18 characters ' +
        '(2 country + 2 check digits + 3 business code + 11 national identifier)',
    }
  )

/**
 * The party collecting funds via direct debit.
 * Lives at document level for naturalness; the writer fans it out into every PmtInf.
 */
const CreditorSchema = z.object({
  /** Creditor party name (Cdtr/Nm), max 70 chars, SEPA charset. */
  name: sepaText(70),
  /** Creditor IBAN (CdtrAcct/Id/IBAN), mod-97 validated. */
  iban: IBANSchema,
  /** BIC of the creditor's bank (CdtrAgt/FinInstnId/BICFI). Optional. */
  bic: BICSchema.optional(),
  /**
   * Structured postal address (PstlAdr), optional.
   * Emitted for pain.008.001.08 only.
   * EPC mandates this from 2026-11-22.
   */
  address: PostalAddressSchema.optional(),
  /**
   * SEPA Creditor Identifier (CdtrSchmeId/Id/PrvtId/Othr/Id).
   * Written with SchmeNm/Prtry = "SEPA".
   * Validated by format regex AND ISO 7064 MOD 97-10 check digit (business code excluded per spec).
   */
  creditorId: CreditorIdSchema,
})

export type Creditor = z.infer<typeof CreditorSchema>

// ---------------------------------------------------------------------------
// Mandate: the authorization given by a debtor
// ---------------------------------------------------------------------------

/**
 * Mandate amendment details (maps to DrctDbtTx/MndtRltdInf/AmdmntInfDtls).
 *
 * When a mandate's details change (new debtor account, new mandate id at the creditor,
 * or the same mandate moving to a new account at the same bank via SMNDA), the file
 * carries AmdmntInd=true and this record inside AmdmntInfDtls.
 *
 * Minimal common-case fields only. The remaining AmendmentInformationDetails13 sub-fields
 * (original creditor scheme id, original debtor name/agent, frequency, final collection
 * date, reason) are not modelled here and are a documented follow-up.
 *
 * Validation invariants (enforced as Zod refinements):
 * 1. originalDebtorAccount, when present, must be a valid IBAN.
 * 2. At least one detail must be meaningful: at least one of originalMandateId,
 *    originalDebtorAccount, or sameMandateNewDebtorAccount===true must be present.
 *    An empty or all-false object is rejected.
 * 3. originalDebtorAccount and sameMandateNewDebtorAccount===true are mutually exclusive:
 *    SMNDA means "same bank, new account, account not disclosed", so providing an
 *    explicit old account contradicts it.
 */
const MandateAmendmentSchema = z
  .object({
    /**
     * Original mandate identifier (AmdmntInfDtls/OrgnlMndtId).
     * Present when the creditor's mandate reference changes.
     */
    originalMandateId: SepaMax35Text.optional(),
    /**
     * Original debtor account IBAN (AmdmntInfDtls/OrgnlDbtrAcct/Id/IBAN).
     * Present when the debtor's bank account changes. Must be a valid IBAN.
     */
    originalDebtorAccount: IBANSchema.optional(),
    /**
     * Same Mandate New Debtor Account (SMNDA) flag.
     * Maps to AmdmntInfDtls/OrgnlDbtrAgt/FinInstnId/Othr/Id = "SMNDA".
     * Signals that the mandate stays the same but the debtor opens a new account
     * at the same bank. The old account number is not disclosed.
     * Mutually exclusive with originalDebtorAccount.
     * When true, the batch sequenceType MUST be FRST (enforced by R4 in dd-rules.ts
     * and by the writer before emitting XML).
     */
    sameMandateNewDebtorAccount: z.boolean().optional(),
  })
  .refine(
    (a) =>
      a.originalMandateId !== undefined ||
      a.originalDebtorAccount !== undefined ||
      a.sameMandateNewDebtorAccount === true,
    {
      message:
        'A mandate amendment must contain at least one meaningful detail: ' +
        'set originalMandateId, originalDebtorAccount, or sameMandateNewDebtorAccount=true',
    }
  )
  .refine(
    (a) => !(a.originalDebtorAccount !== undefined && a.sameMandateNewDebtorAccount === true),
    {
      message:
        'originalDebtorAccount and sameMandateNewDebtorAccount=true are mutually exclusive: ' +
        'SMNDA signals the old account is not disclosed, so providing an explicit original IBAN contradicts it',
    }
  )

export type MandateAmendment = z.infer<typeof MandateAmendmentSchema>

/**
 * Direct debit mandate (maps to DrctDbtTx/MndtRltdInf).
 */
const MandateSchema = z.object({
  /** Mandate identifier (MndtId), max 35 chars, SEPA charset. */
  id: SepaMax35Text,
  /** Date of signature (DtOfSgntr), YYYY-MM-DD. */
  signatureDate: ISODateSchema,
  /**
   * Optional amendment details. When present, the writer emits AmdmntInd=true
   * and AmdmntInfDtls inside MndtRltdInf. Supported for pain.008.001.08 ONLY.
   * The DK variant (pain.008.003.02) throws if this is set.
   */
  amendment: MandateAmendmentSchema.optional(),
})

export type Mandate = z.infer<typeof MandateSchema>

// ---------------------------------------------------------------------------
// Collection: one direct debit transaction
// ---------------------------------------------------------------------------

/**
 * One direct debit transaction (maps to DrctDbtTxInf).
 */
const CollectionSchema = z
  .object({
    /** End-to-end identifier (PmtId/EndToEndId), max 35 chars, SEPA charset, EPC slash rules. */
    endToEndId: sepaIdentifier(35),
    /** Amount to collect (InstdAmt Ccy="EUR"). */
    amount: MoneySchema,
    /**
     * Ultimate creditor (UltmtCdtr): the party that ultimately receives the collected funds.
     * Optional. Supported for pain.008.001.08 only. Name only in this version (max 70 chars).
     */
    ultimateCreditor: UltimatePartySchema.optional(),
    /** Debtor party (Dbtr/Nm + DbtrAcct/Id/IBAN + DbtrAgt/FinInstnId/BICFI). */
    debtor: z.object({
      name: sepaText(70),
      iban: IBANSchema,
      bic: BICSchema.optional(),
      /**
       * Structured postal address (PstlAdr), optional.
       * Emitted for pain.008.001.08 only.
       * EPC mandates this from 2026-11-22.
       */
      address: PostalAddressSchema.optional(),
    }),
    /**
     * Ultimate debtor (UltmtDbtr): the party on whose behalf the collection is made.
     * Optional. Supported for pain.008.001.08 only. Name only in this version (max 70 chars).
     */
    ultimateDebtor: UltimatePartySchema.optional(),
    /** Mandate authorizing this collection. */
    mandate: MandateSchema,
    /** Remittance information (RmtInf/Ustrd), max 140 chars, SEPA charset. Optional. */
    remittanceInfo: SepaMax140Text.optional(),
    /**
     * Structured remittance information (RmtInf/Strd/CdtrRefInf).
     * Mutually exclusive with remittanceInfo. Supported for pain.008.001.08 ONLY.
     * Legacy and DK variants throw if this field is set.
     */
    structuredRemittance: StructuredRemittanceSchema.optional(),
    /**
     * Transaction-level purpose (DrctDbtTxInf/Purp), Purpose2Choice (Cd XOR Prtry).
     * A plain string is the Cd code path (ExternalPurpose1Code, open string, 1-4 chars,
     * not validated against the ISO external list). An object { proprietary } is the
     * Prtry path (Max35Text). Common Cd values: SALA, SUPP, TAXS, GDDS.
     * Supported for pain.008.001.08 ONLY. DK variant throws if this is set.
     */
    purpose: PurposeSchema.optional(),
  })
  .refine((col) => !(col.remittanceInfo !== undefined && col.structuredRemittance !== undefined), {
    message:
      'A collection must not have both remittanceInfo (unstructured) and structuredRemittance (structured) set: the SEPA rulebook allows only one form of remittance information per transaction',
  })

export type Collection = z.infer<typeof CollectionSchema>

// ---------------------------------------------------------------------------
// DirectDebitBatch: one PmtInf element
// ---------------------------------------------------------------------------

/**
 * A batch of collections on one date with one sequence type (maps to PmtInf).
 */
const DirectDebitBatchSchema = z
  .object({
    /** Payment information identifier (PmtInfId), max 35 chars, SEPA charset, EPC slash rules. */
    id: sepaIdentifier(35),
    /** Requested collection date (ReqdColltnDt), YYYY-MM-DD. */
    collectionDate: ISODateSchema,
    /** Sequence type (PmtTpInf/SeqTp). */
    sequenceType: SequenceTypeSchema,
    /** Local instrument code (PmtTpInf/LclInstrm/Cd). Defaults to "CORE" when omitted. */
    localInstrument: LocalInstrumentSchema.optional(),
    /**
     * Batch-level category purpose (PmtTpInf/CtgyPurp), CategoryPurpose1Choice (Cd XOR Prtry).
     * A plain string is the Cd code path (ExternalCategoryPurpose1Code, open string, 1-4 chars,
     * not validated against the ISO external list). An object { proprietary } is the Prtry path
     * (Max35Text). Common Cd values: SALA, SUPP, CASH, SECU.
     * Supported for pain.008.001.08 ONLY. DK variant throws if this is set.
     */
    categoryPurpose: CategoryPurposeSchema.optional(),
    /** Collections in this batch. At least one required. */
    collections: z.array(CollectionSchema).min(1),
  })
  .refine((b) => b.collections.length > 0, {
    message: 'DirectDebitBatch must contain at least one collection',
  })

export type DirectDebitBatch = z.infer<typeof DirectDebitBatchSchema>

// ---------------------------------------------------------------------------
// DirectDebitDocument: the whole document
// ---------------------------------------------------------------------------

/**
 * The top-level document model for pain.008.001.08.
 *
 * NbOfTxs and CtrlSum are DERIVED by the writer (exact bigint arithmetic),
 * so they are NOT part of this model.
 */
export const DirectDebitDocumentSchema = z
  .object({
    /** Message ID (GrpHdr/MsgId), max 35 chars, SEPA charset, EPC slash rules. */
    messageId: sepaIdentifier(35),
    /** Creation date-time (GrpHdr/CreDtTm), ISO 8601 datetime. */
    createdAt: ISODateTimeSchema,
    /** Initiating party name (GrpHdr/InitgPty/Nm), max 70 chars, SEPA charset. */
    initiatingParty: sepaText(70),
    /** The party collecting funds. Written into every PmtInf by the writer. */
    creditor: CreditorSchema,
    /** Payment batches (PmtInf). At least one required. */
    batches: z.array(DirectDebitBatchSchema).min(1),
  })
  .refine(
    (doc) => {
      const totalTxs = doc.batches.reduce((sum, batch) => sum + batch.collections.length, 0)
      return totalTxs >= 1
    },
    { message: 'Document must contain at least one collection' }
  )

export type DirectDebitDocument = z.infer<typeof DirectDebitDocumentSchema>
