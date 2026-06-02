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
 * SEPA original mandate frequency code (AmdmntInfDtls/OrgnlFrqcy/Tp).
 * Maps to Frequency36Choice with the Tp branch (Frequency6Code enumeration).
 * We support the Tp (code) branch only, which is XSD-valid; the Prd and PtInTm
 * branches are a documented follow-up.
 */
export const FrequencyCodeSchema = z.enum([
  'YEAR',
  'MNTH',
  'QURT',
  'MIAN',
  'WEEK',
  'DAIL',
  'ADHO',
  'INDA',
  'FRTN',
])
export type FrequencyCode = z.infer<typeof FrequencyCodeSchema>

/**
 * Original mandate setup reason (AmdmntInfDtls/OrgnlRsn), MandateSetupReason1Choice: Cd XOR Prtry.
 *
 * A plain string is the Cd code path (ExternalMandateSetupReason1Code, an open string of
 * 1..4 chars, NOT an enumeration, so we validate charset and length only and do NOT check
 * membership against the externally-published ISO list). An object { proprietary } is the
 * Prtry path (Max70Text). The two shapes are structurally disjoint (string vs object), so
 * the union itself enforces "exactly one", matching the XSD choice.
 */
const MandateReasonCodeSchema = sepaText(4)
const MandateReasonProprietarySchema = z.object({
  /** Proprietary reason value (Prtry), max 70 chars, SEPA charset. */
  proprietary: sepaText(70),
})
export const MandateSetupReasonSchema = z.union([
  MandateReasonCodeSchema,
  MandateReasonProprietarySchema,
])
export type MandateSetupReason = z.infer<typeof MandateSetupReasonSchema>

/**
 * Original creditor scheme identification (AmdmntInfDtls/OrgnlCdtrSchmeId).
 *
 * Maps to PartyIdentification135. We support a name (Nm) and the SEPA Creditor Identifier
 * (Id/PrvtId/Othr/Id with SchmeNm/Prtry=SEPA), which is the common SDD usage. At least one
 * of name or creditorId must be present (an empty element carries no information).
 * The creditorId reuses the same ISO 7064 MOD 97-10 validation as the document creditor.
 */
const OriginalCreditorSchemeIdSchema = z
  .object({
    /** Original creditor scheme name (OrgnlCdtrSchmeId/Nm), max 70 chars, SEPA charset. */
    name: sepaText(70).optional(),
    /**
     * Original SEPA Creditor Identifier (OrgnlCdtrSchmeId/Id/PrvtId/Othr/Id).
     * Validated by format and ISO 7064 MOD 97-10 check digit, same as the document creditor.
     */
    creditorId: CreditorIdSchema.optional(),
  })
  .refine((s) => s.name !== undefined || s.creditorId !== undefined, {
    message:
      'originalCreditorSchemeId must set at least one of name or creditorId (an empty element carries no information)',
  })

/**
 * Mandate amendment details (maps to DrctDbtTx/MndtRltdInf/AmdmntInfDtls).
 *
 * When a mandate's details change (new debtor account, new mandate id at the creditor,
 * or the same mandate moving to a new account at the same bank via SMNDA), the file
 * carries AmdmntInd=true and this record inside AmdmntInfDtls.
 *
 * Covers the AmendmentInformationDetails13 fields that carry common SDD amendment data:
 * originalMandateId, originalCreditorSchemeId, originalDebtor, originalDebtorAccount,
 * originalDebtorAgent (BIC) / sameMandateNewDebtorAccount (SMNDA), originalFinalCollectionDate,
 * originalFrequency, originalReason. The OrgnlCdtrAgt(Acct), OrgnlDbtrAgtAcct and OrgnlTrckgDays
 * sub-fields are not modelled here and are a documented follow-up.
 *
 * Validation invariants (enforced as Zod refinements):
 * 1. originalDebtorAccount, when present, must be a valid IBAN.
 * 2. At least one detail must be meaningful: at least one amendment field must be present.
 *    An empty or all-false object is rejected.
 * 3. originalDebtorAccount and sameMandateNewDebtorAccount===true are mutually exclusive:
 *    SMNDA means "same bank, new account, account not disclosed", so providing an
 *    explicit old account contradicts it.
 * 4. originalDebtorAgent (a real BIC) and sameMandateNewDebtorAccount===true are mutually
 *    exclusive: both serialize to OrgnlDbtrAgt and the XSD allows only one, so the SMNDA
 *    marker and an explicit agent BIC cannot coexist.
 */
const MandateAmendmentSchema = z
  .object({
    /**
     * Original mandate identifier (AmdmntInfDtls/OrgnlMndtId).
     * Present when the creditor's mandate reference changes.
     */
    originalMandateId: SepaMax35Text.optional(),
    /**
     * Original creditor scheme identification (AmdmntInfDtls/OrgnlCdtrSchmeId).
     * Present when the creditor identifier or name changes. PartyIdentification135.
     */
    originalCreditorSchemeId: OriginalCreditorSchemeIdSchema.optional(),
    /**
     * Original debtor (AmdmntInfDtls/OrgnlDbtr), name only first cut (PartyIdentification135/Nm).
     * Present when the debtor party name changes.
     */
    originalDebtor: z.object({ name: sepaText(70) }).optional(),
    /**
     * Original debtor account IBAN (AmdmntInfDtls/OrgnlDbtrAcct/Id/IBAN).
     * Present when the debtor's bank account changes. Must be a valid IBAN.
     */
    originalDebtorAccount: IBANSchema.optional(),
    /**
     * Original debtor agent BIC (AmdmntInfDtls/OrgnlDbtrAgt/FinInstnId/BICFI).
     * Present when the debtor's bank changes and the original bank is disclosed.
     * Mutually exclusive with sameMandateNewDebtorAccount: both serialize to OrgnlDbtrAgt
     * and the XSD allows only one occurrence.
     */
    originalDebtorAgent: BICSchema.optional(),
    /**
     * Same Mandate New Debtor Account (SMNDA) flag.
     * Maps to AmdmntInfDtls/OrgnlDbtrAgt/FinInstnId/Othr/Id = "SMNDA".
     * Signals that the mandate stays the same but the debtor opens a new account
     * at the same bank. The old account number is not disclosed.
     * Mutually exclusive with originalDebtorAccount and originalDebtorAgent.
     * When true, the batch sequenceType MUST be FRST (enforced by R4 in dd-rules.ts
     * and by the writer before emitting XML).
     */
    sameMandateNewDebtorAccount: z.boolean().optional(),
    /**
     * Original final collection date (AmdmntInfDtls/OrgnlFnlColltnDt), YYYY-MM-DD.
     * The previously-agreed final collection date of the mandate.
     */
    originalFinalCollectionDate: ISODateSchema.optional(),
    /**
     * Original frequency (AmdmntInfDtls/OrgnlFrqcy/Tp), Frequency6Code.
     * The previously-agreed collection frequency, e.g. MNTH or YEAR.
     */
    originalFrequency: FrequencyCodeSchema.optional(),
    /**
     * Original mandate setup reason (AmdmntInfDtls/OrgnlRsn), MandateSetupReason1Choice.
     * A plain string is the Cd path (1..4 chars); an object { proprietary } is the Prtry path.
     */
    originalReason: MandateSetupReasonSchema.optional(),
  })
  .refine(
    (a) =>
      a.originalMandateId !== undefined ||
      a.originalCreditorSchemeId !== undefined ||
      a.originalDebtor !== undefined ||
      a.originalDebtorAccount !== undefined ||
      a.originalDebtorAgent !== undefined ||
      a.sameMandateNewDebtorAccount === true ||
      a.originalFinalCollectionDate !== undefined ||
      a.originalFrequency !== undefined ||
      a.originalReason !== undefined,
    {
      message:
        'A mandate amendment must contain at least one meaningful detail: ' +
        'set originalMandateId, originalCreditorSchemeId, originalDebtor, originalDebtorAccount, ' +
        'originalDebtorAgent, sameMandateNewDebtorAccount=true, originalFinalCollectionDate, ' +
        'originalFrequency, or originalReason',
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
  .refine((a) => !(a.originalDebtorAgent !== undefined && a.sameMandateNewDebtorAccount === true), {
    message:
      'originalDebtorAgent and sameMandateNewDebtorAccount=true are mutually exclusive: ' +
      'both serialize to OrgnlDbtrAgt and the XSD allows only one, so the SMNDA marker and an ' +
      'explicit agent BIC cannot coexist',
  })

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
