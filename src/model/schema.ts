/**
 * Zod schema definitions for pain.001.001.09 (CustomerCreditTransferInitiation).
 *
 * The model is designed to feel natural to a developer thinking about a payment,
 * not to mirror the XSD element tree 1:1.
 *
 * Anchored on the XSD: schemas/iso20022/pain.001.001.09.xsd
 */

import { z } from 'zod'
import { isValidIban } from './iban.js'
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

/** Max35Text with SEPA charset validation */
const SepaMax35Text = sepaText(35)

/** Max140Text with SEPA charset validation */
const SepaMax140Text = sepaText(140)

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
  .regex(/^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$/, 'Invalid IBAN format')
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

/** Minimum allowed amount in minor units (0.01 EUR = 1 cent). */
const MIN_AMOUNT_MINOR = 1n

/** Maximum amount in minor units (matches XSD decimal precision). */
const MAX_AMOUNT_MINOR = 999_999_999_999_999_99n

/**
 * Money is a first-class value. SEPA is EUR-only.
 * minorUnits is the exact integer amount in cents (no float ever).
 */
export const MoneySchema = z.object({
  currencyCode: z.literal('EUR'),
  minorUnits: z
    .bigint()
    .min(MIN_AMOUNT_MINOR, 'Amount must be at least 0.01 EUR (1 cent)')
    .max(MAX_AMOUNT_MINOR, 'Amount exceeds maximum allowed value'),
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
    throw new Error(`euros(): amount "${amount}" exceeds the maximum allowed value`)
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
// AccountParty: a party tied to a bank account
// ---------------------------------------------------------------------------

/**
 * A party (debtor or creditor) tied to a bank account.
 * Groups name, IBAN, and optional BIC as one natural unit.
 */
const AccountPartySchema = z.object({
  /** Party name (max 70 chars, SEPA charset). */
  name: sepaText(70),
  /** IBAN of the account (mod-97 validated). */
  iban: IBANSchema,
  /** BIC of the party's bank. Optional; validated when present. */
  bic: BICSchema.optional(),
})

export type AccountParty = z.infer<typeof AccountPartySchema>

// ---------------------------------------------------------------------------
// Transfer: one credit transfer transaction
// ---------------------------------------------------------------------------

/**
 * One credit transfer transaction (maps to CdtTrfTxInf).
 */
const TransferSchema = z.object({
  /** End-to-end identifier (PmtId/EndToEndId), max 35 chars, SEPA charset. */
  endToEndId: SepaMax35Text,
  /** Amount: a Money value (euros helper recommended). */
  amount: MoneySchema,
  /** Creditor party (Cdtr + CdtrAcct/IBAN + CdtrAgt/BIC). */
  creditor: AccountPartySchema,
  /** Remittance information / payment purpose (RmtInf/Ustrd), max 140 chars, SEPA charset. Optional. */
  remittanceInfo: SepaMax140Text.optional(),
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
    /** Payment information identifier (PmtInfId), max 35 chars, SEPA charset. */
    id: SepaMax35Text,
    /** Requested execution date (ReqdExctnDt), YYYY-MM-DD. Emitted as Dt (not DtTm). */
    executionDate: ISODateSchema,
    /** Debtor party (Dbtr + DbtrAcct/IBAN + DbtrAgt/BIC). */
    debtor: AccountPartySchema,
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
    /** Message ID (GrpHdr/MsgId), max 35 chars, SEPA charset. */
    messageId: SepaMax35Text,
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
