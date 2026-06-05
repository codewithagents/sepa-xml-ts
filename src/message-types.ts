/**
 * Typed, documented constants for SEPA message types and write variants.
 *
 * Use these constants instead of bare strings for autocomplete and inline documentation.
 * Raw string literals remain valid everywhere (no breaking change): the derived types
 * keep the same resolved string-literal union.
 *
 * Example - parse narrowing:
 *   import { MessageType } from 'sepa-xml-ts'
 *   if (result.type === MessageType.CreditTransfer) { ... }  // same as === 'pain.001'
 *
 * Example - write variant:
 *   import { CreditTransferVariant } from 'sepa-xml-ts'
 *   writeCreditTransfer(doc, { variant: CreditTransferVariant.SCT_DK })
 */

// ---------------------------------------------------------------------------
// MessageType
// ---------------------------------------------------------------------------

/**
 * Discriminator constants returned by `parse()`.
 *
 * These match the `type` field on a successful `ParseResult` so you can
 * narrow the discriminated union with a readable name instead of a raw string.
 */
export const MessageType = {
  /**
   * SEPA Credit Transfer (pain.001). You push payments to many creditors.
   * Returned as `result.type` when `parse()` reads a pain.001 document.
   */
  CreditTransfer: 'pain.001',
  /**
   * SEPA Direct Debit (pain.008). You pull payments from many debtors.
   * Returned as `result.type` when `parse()` reads a pain.008 document.
   */
  DirectDebit: 'pain.008',
} as const

/** Literal union of all recognised message-type discriminators. */
export type MessageType = (typeof MessageType)[keyof typeof MessageType]

// ---------------------------------------------------------------------------
// CreditTransferVariant
// ---------------------------------------------------------------------------

/**
 * Output schema variant constants for `writeCreditTransfer`.
 *
 * Pass one of these (or the equivalent raw string) as `{ variant }` in
 * `WriteCreditTransferOptions`. Defaults to `SCT_V09` when omitted.
 */
export const CreditTransferVariant = {
  /**
   * Modern ISO SEPA Credit Transfer: pain.001.001.09.
   * V09 refers to ISO message version .09 (the current schema, published 2019).
   * The default. Use this unless your bank specifically requires an older format.
   */
  SCT_V09: 'pain.001.001.09',
  /**
   * Legacy ISO Credit Transfer: pain.001.001.03.
   * Some banks still require this older format on the wire. It uses a plain
   * ReqdExctnDt (no Dt wrapper), BIC element instead of BICFI, and an empty
   * FinInstnId fallback for DbtrAgt when no BIC is set.
   */
  SCT_Legacy: 'pain.001.001.03',
  /**
   * German DK national Credit Transfer: pain.001.003.03.
   * Defined by the Deutsche Kreditwirtschaft (DK). Uses a different namespace,
   * plain ReqdExctnDt, BIC element, and NOTPROVIDED fallback for DbtrAgt.
   * Restricted to Ctry + AdrLine for postal addresses.
   */
  SCT_DK: 'pain.001.003.03',
} as const

/**
 * Literal union of all supported credit-transfer write variants.
 * Identical to the string union accepted by `WriteCreditTransferOptions.variant`.
 */
export type CreditTransferVariant =
  (typeof CreditTransferVariant)[keyof typeof CreditTransferVariant]

// ---------------------------------------------------------------------------
// DirectDebitVariant
// ---------------------------------------------------------------------------

/**
 * Output schema variant constants for `writeDirectDebit`.
 *
 * Pass one of these (or the equivalent raw string) as `{ variant }` in
 * `WriteDirectDebitOptions`. Defaults to `SDD_V08` when omitted.
 */
export const DirectDebitVariant = {
  /**
   * Modern ISO SEPA Direct Debit: pain.008.001.08.
   * V08 refers to ISO message version .08 (the current schema, published 2019).
   * The default. Use this unless your bank specifically requires the DK variant.
   */
  SDD_V08: 'pain.008.001.08',
  /**
   * German DK national Direct Debit: pain.008.003.02.
   * Defined by the Deutsche Kreditwirtschaft (DK). Uses a different namespace,
   * BIC element instead of BICFI, NOTPROVIDED fallback, and omits CtrlSum from
   * GrpHdr. Restricted to Ctry + AdrLine for postal addresses.
   */
  SDD_DK: 'pain.008.003.02',
} as const

/**
 * Literal union of all supported direct-debit write variants.
 * Identical to the string union accepted by `WriteDirectDebitOptions.variant`.
 */
export type DirectDebitVariant = (typeof DirectDebitVariant)[keyof typeof DirectDebitVariant]
