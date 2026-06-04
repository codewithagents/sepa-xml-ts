/**
 * Shared internal Zod schemas used by both schema.ts (pain.001) and pain008.ts (pain.008).
 *
 * These are internal to the model layer and NOT exported from the public API.
 * Only include schemas that are byte-for-byte identical across both modules.
 */

import { z } from 'zod'
import { isValidIban } from './iban.js'

// ---------------------------------------------------------------------------
// Shared: IBAN and BIC schemas
// ---------------------------------------------------------------------------

/**
 * IBAN validated by mod-97 checksum.
 * Identical in schema.ts and pain008.ts; extracted here to remove the duplication.
 */
export const IBANSchema = z
  .string()
  .regex(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/, 'Invalid IBAN format')
  .refine((v) => isValidIban(v), {
    message: 'IBAN failed mod-97 checksum validation',
  })

/**
 * BIC/SWIFT identifier (optional).
 * Identical in schema.ts and pain008.ts; extracted here to remove the duplication.
 */
export const BICSchema = z
  .string()
  .regex(/^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/, 'Invalid BIC/SWIFT format')
