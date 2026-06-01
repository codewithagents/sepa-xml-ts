/**
 * Business validation for pain.001 credit transfer and pain.008 direct debit documents.
 * Returns structured errors rather than throwing.
 */

import { z } from 'zod'
import { CreditTransferDocumentSchema, type CreditTransferDocument } from './schema.js'
import { DirectDebitDocumentSchema, type DirectDebitDocument } from './pain008.js'
import type { BankProfile, ProfileIssue } from '../profile/profile.js'

export type ValidationSuccess = { ok: true; data: CreditTransferDocument }
export type ValidationFailure = { ok: false; errors: z.ZodIssue[]; profileIssues?: ProfileIssue[] }
export type ValidationResult = ValidationSuccess | ValidationFailure

export type DirectDebitValidationSuccess = { ok: true; data: DirectDebitDocument }
export type DirectDebitValidationFailure = {
  ok: false
  errors: z.ZodIssue[]
  profileIssues?: ProfileIssue[]
}
export type DirectDebitValidationResult =
  | DirectDebitValidationSuccess
  | DirectDebitValidationFailure

/** Options accepted by validateCreditTransfer and validateDirectDebit. */
export interface ValidateOptions {
  /**
   * A bank profile to run alongside the base Zod validation.
   * Profile issues are merged into the result; ok is true only if both pass.
   */
  profile?: BankProfile
}

/**
 * Validate a credit transfer document against the Zod schema and business rules.
 * When a profile is supplied, profile issues are also included; ok is true only
 * if both the schema and the profile pass.
 *
 * @param input unknown input to validate
 * @param options optional validation options (profile)
 * @returns ValidationResult with either the parsed data or the errors
 */
export function validateCreditTransfer(
  input: unknown,
  options?: ValidateOptions
): ValidationResult {
  const result = CreditTransferDocumentSchema.safeParse(input)
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
 * @param options optional validation options (profile)
 * @returns DirectDebitValidationResult with either the parsed data or the errors
 */
export function validateDirectDebit(
  input: unknown,
  options?: ValidateOptions
): DirectDebitValidationResult {
  const result = DirectDebitDocumentSchema.safeParse(input)
  if (!result.success) {
    return { ok: false, errors: result.error.issues }
  }

  // Base schema passed; now run profile checks if provided
  const profile = options?.profile
  if (profile?.checkDirectDebit !== undefined) {
    const profileIssues = profile.checkDirectDebit(result.data)
    if (profileIssues.length > 0) {
      return { ok: false, errors: [], profileIssues }
    }
  }

  return { ok: true, data: result.data }
}

/**
 * Alias for validateCreditTransfer. Kept for backward compatibility (shipped in 0.1.0/0.2.0).
 */
export const validate = validateCreditTransfer
