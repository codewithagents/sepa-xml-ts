/**
 * Zod schema definitions for pain.008.001.08 (CustomerDirectDebitInitiation).
 *
 * Direct debit is the reverse of credit transfer: one creditor collects money
 * from many debtors, each authorized by a signed mandate.
 *
 * Anchored on the XSD: schemas/iso20022/pain.008.001.08.xsd
 * Namespace: urn:iso:std:iso:20022:tech:xsd:pain.008.001.08
 */

import { z } from "zod";
import { isValidIban } from "./iban.js";
import { isSepaCharset } from "./charset.js";
import { MoneySchema } from "./schema.js";
import { isValidCreditorId } from "./creditor-id.js";

// ---------------------------------------------------------------------------
// Internal validators (shared with pain001 but redefined for independence)
// ---------------------------------------------------------------------------

const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function sepaText(maxLen: number) {
  return z
    .string()
    .min(1)
    .max(maxLen)
    .refine((v) => isSepaCharset(v), {
      message: `Value contains characters outside the SEPA charset (EPC217-08)`,
    });
}

const SepaMax35Text = sepaText(35);
const SepaMax140Text = sepaText(140);

const ISODateTimeSchema = z
  .string()
  .regex(ISO_DATETIME_PATTERN, "Must be a valid ISO 8601 datetime");

const ISODateSchema = z
  .string()
  .regex(ISO_DATE_PATTERN, "Must be a valid ISO 8601 date in YYYY-MM-DD format");

const IBANSchema = z
  .string()
  .regex(/^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$/, "Invalid IBAN format")
  .refine((v) => isValidIban(v), {
    message: "IBAN failed mod-97 checksum validation",
  });

const BICSchema = z
  .string()
  .regex(
    /^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/,
    "Invalid BIC/SWIFT format"
  );

// ---------------------------------------------------------------------------
// SequenceType: SEPA direct debit sequence types
// ---------------------------------------------------------------------------

/**
 * SEPA direct debit sequence type (PmtTpInf/SeqTp).
 * FRST: First collection. RCUR: Recurring. OOFF: One-off. FNAL: Final.
 */
export const SequenceTypeSchema = z.enum(["FRST", "RCUR", "OOFF", "FNAL"]);
export type SequenceType = z.infer<typeof SequenceTypeSchema>;

/**
 * SEPA local instrument code (PmtTpInf/LclInstrm/Cd).
 * CORE: standard SEPA Core Direct Debit. B2B: SEPA Business-to-Business Direct Debit.
 */
export const LocalInstrumentSchema = z.enum(["CORE", "B2B"]);
export type LocalInstrument = z.infer<typeof LocalInstrumentSchema>;

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
    /^[A-Z]{2}[0-9]{2}[A-Z0-9]{3}[a-zA-Z0-9]{1,28}$/,
    "Invalid SEPA Creditor Identifier format (expected: CC + 2 digits + 3 char business code + identifier)"
  )
  .refine((v) => isValidCreditorId(v), {
    message: "SEPA Creditor Identifier failed ISO 7064 MOD 97-10 check digit validation",
  });

/**
 * The party collecting funds via direct debit.
 * Lives at document level for naturalness; the writer fans it out into every PmtInf.
 */
export const CreditorSchema = z.object({
  /** Creditor party name (Cdtr/Nm), max 70 chars, SEPA charset. */
  name: sepaText(70),
  /** Creditor IBAN (CdtrAcct/Id/IBAN), mod-97 validated. */
  iban: IBANSchema,
  /** BIC of the creditor's bank (CdtrAgt/FinInstnId/BICFI). Optional. */
  bic: BICSchema.optional(),
  /**
   * SEPA Creditor Identifier (CdtrSchmeId/Id/PrvtId/Othr/Id).
   * Written with SchmeNm/Prtry = "SEPA".
   * Validated by format regex AND ISO 7064 MOD 97-10 check digit (business code excluded per spec).
   */
  creditorId: CreditorIdSchema,
});

export type Creditor = z.infer<typeof CreditorSchema>;

// ---------------------------------------------------------------------------
// Mandate: the authorization given by a debtor
// ---------------------------------------------------------------------------

/**
 * Direct debit mandate (maps to DrctDbtTx/MndtRltdInf).
 */
export const MandateSchema = z.object({
  /** Mandate identifier (MndtId), max 35 chars, SEPA charset. */
  id: SepaMax35Text,
  /** Date of signature (DtOfSgntr), YYYY-MM-DD. */
  signatureDate: ISODateSchema,
});

export type Mandate = z.infer<typeof MandateSchema>;

// ---------------------------------------------------------------------------
// Collection: one direct debit transaction
// ---------------------------------------------------------------------------

/**
 * One direct debit transaction (maps to DrctDbtTxInf).
 */
export const CollectionSchema = z.object({
  /** End-to-end identifier (PmtId/EndToEndId), max 35 chars, SEPA charset. */
  endToEndId: SepaMax35Text,
  /** Amount to collect (InstdAmt Ccy="EUR"). */
  amount: MoneySchema,
  /** Debtor party (Dbtr/Nm + DbtrAcct/Id/IBAN + DbtrAgt/FinInstnId/BICFI). */
  debtor: z.object({
    name: sepaText(70),
    iban: IBANSchema,
    bic: BICSchema.optional(),
  }),
  /** Mandate authorizing this collection. */
  mandate: MandateSchema,
  /** Remittance information (RmtInf/Ustrd), max 140 chars, SEPA charset. Optional. */
  remittanceInfo: SepaMax140Text.optional(),
});

export type Collection = z.infer<typeof CollectionSchema>;

// ---------------------------------------------------------------------------
// DirectDebitBatch: one PmtInf element
// ---------------------------------------------------------------------------

/**
 * A batch of collections on one date with one sequence type (maps to PmtInf).
 */
export const DirectDebitBatchSchema = z
  .object({
    /** Payment information identifier (PmtInfId), max 35 chars, SEPA charset. */
    id: SepaMax35Text,
    /** Requested collection date (ReqdColltnDt), YYYY-MM-DD. */
    collectionDate: ISODateSchema,
    /** Sequence type (PmtTpInf/SeqTp). */
    sequenceType: SequenceTypeSchema,
    /** Local instrument code (PmtTpInf/LclInstrm/Cd). Defaults to "CORE" when omitted. */
    localInstrument: LocalInstrumentSchema.optional(),
    /** Collections in this batch. At least one required. */
    collections: z.array(CollectionSchema).min(1),
  })
  .refine((b) => b.collections.length > 0, {
    message: "DirectDebitBatch must contain at least one collection",
  });

export type DirectDebitBatch = z.infer<typeof DirectDebitBatchSchema>;

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
    /** Message ID (GrpHdr/MsgId), max 35 chars, SEPA charset. */
    messageId: SepaMax35Text,
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
      const totalTxs = doc.batches.reduce(
        (sum, batch) => sum + batch.collections.length,
        0
      );
      return totalTxs >= 1;
    },
    { message: "Document must contain at least one collection" }
  );

export type DirectDebitDocument = z.infer<typeof DirectDebitDocumentSchema>;
