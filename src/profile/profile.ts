/**
 * Bank profile seam: overlay rules and minor output tweaks on top of the SEPA core.
 *
 * A BankProfile is NOT a different message schema. It is an additive layer that:
 *   1. Adds extra validation rules (checkCreditTransfer / checkDirectDebit), and
 *   2. Optionally adjusts the output in ways that stay XSD-valid (output options).
 *
 * Writers reject any document that fails a profile check, ensuring the emitted
 * file always satisfies both the SEPA XSD and the selected bank's extra rules.
 */

import type { CreditTransferDocument } from '../model/schema.js'
import type { DirectDebitDocument } from '../model/pain008.js'

/** A single validation issue reported by a profile check. */
export interface ProfileIssue {
  /** Dot-delimited path to the offending field, e.g. "batches.0.debtor.bic". */
  path?: string
  /** Human-readable description of the problem. */
  message: string
}

/**
 * A bank profile: overlay rules and optional output tweaks for a specific bank.
 *
 * Implement this interface to describe bank-specific requirements that go beyond
 * the SEPA XSD and the base Zod schema. Keep the core pain.001 / pain.008 model
 * clean; put bank-specific logic here.
 */
export interface BankProfile {
  /** Unique identifier for this profile, e.g. "require-bic". */
  readonly id: string
  /** Human-readable description of what this profile enforces. */
  readonly description?: string
  /**
   * Extra validation for pain.001 credit transfer documents.
   * Called after base Zod validation passes.
   * Return an empty array to indicate the document passes this profile's rules.
   */
  readonly checkCreditTransfer?: (doc: CreditTransferDocument) => ProfileIssue[]
  /**
   * Extra validation for pain.008 direct debit documents.
   * Called after base Zod validation passes.
   * Return an empty array to indicate the document passes this profile's rules.
   */
  readonly checkDirectDebit?: (doc: DirectDebitDocument) => ProfileIssue[]
  /**
   * Additive output options applied by the writers.
   * All options must keep the emitted XML XSD-valid.
   */
  readonly output?: {
    /**
     * Emit <BtchBookg>true</BtchBookg> or <BtchBookg>false</BtchBookg> in each
     * PmtInf element. The XSD position is after PmtMtd and before NbOfTxs.
     * When undefined, BtchBookg is not emitted (default behaviour unchanged).
     */
    readonly batchBooking?: boolean
  }
}
