/**
 * Shared internal Zod schemas used by both schema.ts (pain.001) and pain008.ts (pain.008).
 *
 * These are internal to the model layer and NOT exported from the public API.
 * Only include schemas that are byte-for-byte identical across both modules.
 */

import { z } from 'zod'
import { isValidIban } from './iban.js'
import {
  isInSepaCharset,
  isSepaBasic,
  textCharsetMessage,
  referenceCharsetMessage,
  type SepaCharset,
} from './charset.js'

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

// ---------------------------------------------------------------------------
// Shared: SEPA string field kinds (the only place the charset rule is applied)
// ---------------------------------------------------------------------------

/**
 * A human-readable text field (names, addresses, remittance information), max N chars.
 * Its character set follows the charset option (EPC217-08 section 6.3).
 */
export function sepaText(maxLen: number, charset: SepaCharset) {
  return z
    .string()
    .min(1)
    .max(maxLen)
    .refine((v) => isInSepaCharset(v, charset), {
      error: (iss) => textCharsetMessage(String(iss.input), charset),
    })
}

/**
 * A reference, code or identification field (codes, Prtry values, references, Strd
 * sub-fields, Id sub-trees, mandate ids), max N chars. Basic Latin in every charset
 * mode (EPC217-08 section 6.3).
 */
export function sepaReference(maxLen: number) {
  return z
    .string()
    .min(1)
    .max(maxLen)
    .refine((v) => isSepaBasic(v), {
      error: (iss) => referenceCharsetMessage(String(iss.input)),
    })
}

/**
 * A SEPA identifier field (MsgId, PmtInfId, EndToEndId): basic Latin in every charset
 * mode PLUS the EPC slash rules: must not start or end with '/', must not contain '//'.
 * Scoped to identifier elements per the EPC rulebook. Party names and mandate
 * ids are NOT subject to the slash rule.
 */
export function sepaIdentifier(maxLen: number) {
  return sepaReference(maxLen)
    .refine((v) => !v.startsWith('/'), {
      message: 'Identifier must not start with a slash (EPC slash rule)',
    })
    .refine((v) => !v.endsWith('/'), {
      message: 'Identifier must not end with a slash (EPC slash rule)',
    })
    .refine((v) => !v.includes('//'), {
      message: 'Identifier must not contain consecutive slashes (EPC slash rule)',
    })
}
