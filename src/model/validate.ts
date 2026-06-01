/**
 * Business validation for pain.001 credit transfer and pain.008 direct debit documents.
 * Returns structured errors rather than throwing.
 */

import { z } from 'zod'
import { CreditTransferDocumentSchema, type CreditTransferDocument } from './schema.js'
import { DirectDebitDocumentSchema, type DirectDebitDocument } from './pain008.js'

export type ValidationSuccess = { ok: true; data: CreditTransferDocument }
export type ValidationFailure = { ok: false; errors: z.ZodIssue[] }
export type ValidationResult = ValidationSuccess | ValidationFailure

export type DirectDebitValidationSuccess = { ok: true; data: DirectDebitDocument }
export type DirectDebitValidationFailure = { ok: false; errors: z.ZodIssue[] }
export type DirectDebitValidationResult =
  | DirectDebitValidationSuccess
  | DirectDebitValidationFailure

/**
 * Validate a credit transfer document against the Zod schema and business rules.
 *
 * @param input unknown input to validate
 * @returns ValidationResult with either the parsed data or the errors
 */
export function validateCreditTransfer(input: unknown): ValidationResult {
  const result = CreditTransferDocumentSchema.safeParse(input)
  if (result.success) {
    return { ok: true, data: result.data }
  }
  return { ok: false, errors: result.error.issues }
}

/**
 * Validate a direct debit document against the Zod schema and business rules.
 *
 * @param input unknown input to validate
 * @returns DirectDebitValidationResult with either the parsed data or the errors
 */
export function validateDirectDebit(input: unknown): DirectDebitValidationResult {
  const result = DirectDebitDocumentSchema.safeParse(input)
  if (result.success) {
    return { ok: true, data: result.data }
  }
  return { ok: false, errors: result.error.issues }
}

/**
 * Alias for validateCreditTransfer. Kept for backward compatibility (shipped in 0.1.0/0.2.0).
 */
export const validate = validateCreditTransfer
