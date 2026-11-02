/**
 * Business validation for pain.001 credit transfer and pain.008 direct debit documents.
 * Returns structured errors rather than throwing.
 */

import { z } from 'zod'
import { creditTransferSchemasFor, type CreditTransferDocument } from './schema.js'
import { directDebitSchemasFor, type DirectDebitDocument } from './pain008.js'
import { resolveSepaCharset, SepaCharset } from './charset.js'
import type { BankProfile, ProfileIssue } from '../profile/profile.js'
import { checkDirectDebitRules } from './dd-rules.js'

export type ValidationSuccess = { ok: true; data: CreditTransferDocument }
export type ValidationFailure = { ok: false; errors: z.ZodIssue[]; profileIssues?: ProfileIssue[] }
export type ValidationResult = ValidationSuccess | ValidationFailure

export type DirectDebitValidationSuccess = { ok: true; data: DirectDebitDocument }
export type DirectDebitValidationFailure = {
  ok: false
  errors: z.ZodIssue[]
  profileIssues?: ProfileIssue[]
  /** Rule violations from checkDirectDebitRules (R1, R2, R3). Present when rules fail. */
  ruleIssues?: ProfileIssue[]
}
export type DirectDebitValidationResult =
  DirectDebitValidationSuccess | DirectDebitValidationFailure

/** Options accepted by validateCreditTransfer and validateDirectDebit. */
export interface ValidateOptions {
  /**
   * A bank profile to run alongside the base Zod validation.
   * Profile issues are merged into the result; ok is true only if both pass.
   */
  profile?: BankProfile
  /**
   * The character set for human-readable text fields (names, addresses, remittance
   * information). Defaults to 'basic' (SepaCharset.Basic), the basic Latin set every
   * SEPA bank accepts. Pass 'extended' (SepaCharset.Extended) to also accept the
   * EPC217-08 extended set (for example č š ž ä ß Ж € & @), but only if your bank has
   * agreed to receive it. Identifiers, references and codes stay basic Latin in every
   * mode (EPC217-08 section 6.3).
   */
  charset?: SepaCharset
}

/**
 * Validate a credit transfer document against the Zod schema and business rules.
 * When a profile is supplied, profile issues are also included; ok is true only
 * if both the schema and the profile pass.
 *
 * @param input unknown input to validate
 * @param options optional validation options (profile, charset)
 * @returns ValidationResult with either the parsed data or the errors
 * @throws Error if options.charset is not 'basic' or 'extended'
 */
export function validateCreditTransfer(
  input: unknown,
  options?: ValidateOptions
): ValidationResult {
  const charset = resolveSepaCharset(options?.charset, SepaCharset.Basic)
  const result = creditTransferSchemasFor(charset).CreditTransferDocument.safeParse(input)
  if (!result.success) {
    return { ok: false, errors: result.error.issues }
  }

  // Base schema passed; now run profile checks if provided
  const profile = options?.profile
  if (profile?.checkCreditTransfer !== undefined) {
    const profileIssues = profile.checkCreditTransfer(result.data)
    if (profileIssues.length > 0) {
      return { ok: false, errors: [], profileIssues }
    }
  }

  return { ok: true, data: result.data }
}

/**
 * Validate a direct debit document against the Zod schema and business rules.
 * When a profile is supplied, profile issues are also included; ok is true only
 * if both the schema and the profile pass.
 *
 * @param input unknown input to validate
 * @param options optional validation options (profile, charset)
 * @returns DirectDebitValidationResult with either the parsed data or the errors
 * @throws Error if options.charset is not 'basic' or 'extended'
 */
export function validateDirectDebit(
  input: unknown,
  options?: ValidateOptions
): DirectDebitValidationResult {
  const charset = resolveSepaCharset(options?.charset, SepaCharset.Basic)
  const result = directDebitSchemasFor(charset).DirectDebitDocument.safeParse(input)
  if (!result.success) {
    return { ok: false, errors: result.error.issues }
  }

  // Run cross-field SEPA rulebook checks (R1 signature<=collection, R2 OOFF single-use, R3 consistent scheme)
  const ruleIssues = checkDirectDebitRules(result.data)
  if (ruleIssues.length > 0) {
    return { ok: false, errors: [], ruleIssues }
  }

  // Base schema and rules passed; now run profile checks if provided
  const profile = options?.profile
  if (profile?.checkDirectDebit !== undefined) {
    const profileIssues = profile.checkDirectDebit(result.data)
    if (profileIssues.length > 0) {
      return { ok: false, errors: [], profileIssues }
    }
  }

  return { ok: true, data: result.data }
}
