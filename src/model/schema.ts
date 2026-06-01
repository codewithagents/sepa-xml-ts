/**
 * Zod schema definitions for pain.001.001.09 (CustomerCreditTransferInitiation).
 *
 * Only the minimal required fields for a valid SEPA credit transfer are modelled.
 * Anchored on the XSD: schemas/iso20022/pain.001.001.09.xsd
 */

import { z } from "zod";
import { isValidIban } from "./iban.js";
import { isSepaCharset } from "./charset.js";
import { MIN_AMOUNT_MINOR, MAX_AMOUNT_MINOR } from "./amount.js";

// ISO 8601 datetime pattern (ISODateTime in XSD)
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

// ISO 8601 date pattern (ISODate in XSD, YYYY-MM-DD only, no time component)
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A SEPA name or text field: max 140 chars, SEPA charset.
 * Caller can restrict maxLength further.
 */
function sepaText(maxLen: number) {
  return z
    .string()
    .min(1)
    .max(maxLen)
    .refine((v) => isSepaCharset(v), {
      message: `Value contains characters outside the SEPA charset (EPC217-08): allowed are a-z A-Z 0-9 space / - ? : ( ) . , ' +`,
    });
}

/** Max35Text with SEPA charset validation */
export const SepaMax35Text = sepaText(35);

/** Max140Text with SEPA charset validation */
export const SepaMax140Text = sepaText(140);

/** ISODateTime: full datetime string */
export const ISODateTimeSchema = z
  .string()
  .regex(ISO_DATETIME_PATTERN, "Must be a valid ISO 8601 datetime (e.g. 2024-01-15T10:00:00Z)");

/**
 * ISODate: date only, no time component.
 * The XSD ReqdExctnDt uses DateAndDateTime2Choice which wraps Dt (date) or DtTm (datetime).
 * We always emit Dt (date only) for SEPA compliance.
 */
export const ISODateSchema = z
  .string()
  .regex(ISO_DATE_PATTERN, "Must be a valid ISO 8601 date in YYYY-MM-DD format (no time component)");

/** IBAN validated by mod-97 checksum. */
export const IBANSchema = z
  .string()
  .regex(/^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$/, "Invalid IBAN format")
  .refine((v) => isValidIban(v), {
    message: "IBAN failed mod-97 checksum validation",
  });

/** BIC/SWIFT identifier (optional, used for DbtrAgt). */
export const BICSchema = z
  .string()
  .regex(
    /^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/,
    "Invalid BIC/SWIFT format"
  );

/** Amount in minor units (bigint cents). Must be >= 0.01 EUR. */
export const AmountMinorUnitsSchema = z
  .bigint()
  .min(MIN_AMOUNT_MINOR, "Amount must be at least 0.01 EUR (1 cent)")
  .max(MAX_AMOUNT_MINOR, "Amount exceeds maximum allowed value");

/**
 * Creditor or Debtor party: just a name (Nm is optional in XSD, but we require it for SEPA).
 */
export const PartySchema = z.object({
  /** Party name (Nm), max 140 chars, SEPA charset. Required for SEPA compliance. */
  name: SepaMax140Text,
});

/** Debtor agent (bank): identified by BIC or left as empty FinInstnId for SEPA. */
export const AgentSchema = z.object({
  /** BIC of the debtor's bank. Optional per XSD, but commonly required by banks. */
  bic: BICSchema.optional(),
});

/** A single credit transfer transaction (CdtTrfTxInf). */
export const CreditTransferTransactionSchema = z.object({
  /** End-to-end identifier (PmtId/EndToEndId), max 35 chars. */
  endToEndId: SepaMax35Text,

  /**
   * Instructed amount in minor units (cents).
   * Must be >= 1 (0.01 EUR). Currency is always EUR.
   */
  amountMinorUnits: AmountMinorUnitsSchema,

  /** Creditor party (Cdtr). */
  creditor: PartySchema,

  /** Creditor IBAN (CdtrAcct/Id/IBAN). */
  creditorIban: IBANSchema,
});

/** A payment instruction block (PmtInf). Groups transactions sharing a debit account. */
export const PaymentInstructionSchema = z
  .object({
    /** Payment information identifier (PmtInfId), max 35 chars. */
    paymentInfoId: SepaMax35Text,

    /**
     * Requested execution date (ReqdExctnDt), YYYY-MM-DD.
     * This is emitted as Dt (not DtTm) per SEPA rules.
     */
    requestedExecutionDate: ISODateSchema,

    /** Debtor party (Dbtr). */
    debtor: PartySchema,

    /** Debtor IBAN (DbtrAcct/Id/IBAN). */
    debtorIban: IBANSchema,

    /** Debtor agent / bank (DbtrAgt). */
    debtorAgent: AgentSchema,

    /** Credit transfer transactions (CdtTrfTxInf). At least one required. */
    transactions: z.array(CreditTransferTransactionSchema).min(1),
  })
  .refine(
    (pmtInf) => {
      // CtrlSum for PmtInf = exact sum of transaction amounts
      // (enforced at write time, but we can verify structural consistency here)
      return pmtInf.transactions.length > 0;
    },
    { message: "PaymentInstruction must contain at least one transaction" }
  );

/** Group header (GrpHdr). */
export const GroupHeaderSchema = z.object({
  /** Message ID (MsgId), max 35 chars. */
  messageId: SepaMax35Text,

  /**
   * Creation date-time (CreDtTm), ISO 8601 datetime.
   * Example: "2024-01-15T10:30:00Z"
   */
  creationDateTime: ISODateTimeSchema,

  /** Initiating party (InitgPty). */
  initiatingParty: PartySchema,
});

/**
 * The top-level document model for pain.001.001.09.
 *
 * NbOfTxs and CtrlSum are computed by the writer from the transactions,
 * so they are not part of this input model.
 */
export const CreditTransferDocumentSchema = z
  .object({
    /** Group header (GrpHdr). */
    groupHeader: GroupHeaderSchema,

    /** Payment instruction blocks (PmtInf). At least one required by XSD. */
    paymentInstructions: z.array(PaymentInstructionSchema).min(1),
  })
  .refine(
    (doc) => {
      // Enforce: total number of transactions matches what will be written as NbOfTxs
      const totalTxs = doc.paymentInstructions.reduce(
        (sum, pmtInf) => sum + pmtInf.transactions.length,
        0
      );
      return totalTxs >= 1;
    },
    { message: "Document must contain at least one transaction" }
  );

/** TypeScript type for the top-level document model. */
export type CreditTransferDocument = z.infer<typeof CreditTransferDocumentSchema>;

/** TypeScript type for a payment instruction. */
export type PaymentInstruction = z.infer<typeof PaymentInstructionSchema>;

/** TypeScript type for a credit transfer transaction. */
export type CreditTransferTransaction = z.infer<typeof CreditTransferTransactionSchema>;

/** TypeScript type for the group header. */
export type GroupHeader = z.infer<typeof GroupHeaderSchema>;

/** TypeScript type for a party. */
export type Party = z.infer<typeof PartySchema>;

/** TypeScript type for an agent. */
export type Agent = z.infer<typeof AgentSchema>;
