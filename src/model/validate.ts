/**
 * Business validation for pain.001 credit transfer documents.
 * Returns structured errors rather than throwing.
 */

import { z } from "zod";
import { CreditTransferDocumentSchema, type CreditTransferDocument } from "./schema.js";

export type ValidationSuccess = { ok: true; data: CreditTransferDocument };
export type ValidationFailure = { ok: false; errors: z.ZodIssue[] };
export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Validate a credit transfer document against the Zod schema and business rules.
 *
 * @param input unknown input to validate
 * @returns ValidationResult with either the parsed data or the errors
 */
export function validate(input: unknown): ValidationResult {
  const result = CreditTransferDocumentSchema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, errors: result.error.issues };
}
