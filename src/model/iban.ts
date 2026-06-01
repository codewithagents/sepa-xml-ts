/**
 * IBAN validation using the mod-97 checksum algorithm.
 * Reference: ISO 13616 / EPC IBAN spec.
 */

/**
 * Rearranges an IBAN for mod-97 check:
 * move first 4 characters to the end, then replace letters with digits (A=10, B=11, ..., Z=35).
 */
function ibanToNumeric(iban: string): string {
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let numeric = ''
  for (const ch of rearranged) {
    const code = ch.toUpperCase().charCodeAt(0)
    if (code >= 65 && code <= 90) {
      // A-Z => 10-35
      numeric += (code - 55).toString()
    } else {
      numeric += ch
    }
  }
  return numeric
}

/**
 * Compute mod 97 of a large integer represented as a string.
 * Uses chunked division to avoid floating-point issues.
 */
function mod97(numeric: string): number {
  let remainder = 0
  for (const ch of numeric) {
    remainder = (remainder * 10 + parseInt(ch, 10)) % 97
  }
  return remainder
}

/**
 * Returns true if the IBAN passes the mod-97 checksum.
 * Does NOT check country-specific formats, only the checksum.
 */
export function isValidIban(iban: string): boolean {
  // Basic structural check: uppercase-only body, BBAN length 11-30 (total 15-34).
  // Stricter than the XSD pattern ({1,30}, mixed case) by design:
  // - Floor of 11 BBAN chars (total 15) enforces the ISO 13616 minimum length.
  // - Uppercase-only body rejects lowercase input rather than silently accepting it.
  // The XSD-oracle property test still holds because every IBAN we accept is XSD-valid.
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) {
    return false
  }
  return mod97(ibanToNumeric(iban.toUpperCase())) === 1
}

/**
 * Validates an ISO 11649 creditor reference (Structured Creditor Reference).
 *
 * The algorithm is the same family as IBAN mod-97:
 * - Move the first 4 characters (the "RF" prefix + 2 check digits) to the end.
 * - Replace each letter A-Z with its two-digit value (A=10 ... Z=35).
 * - Interpret the result as a big integer and compute mod 97.
 * - Valid if and only if the remainder equals 1.
 *
 * Only call this function when the reference starts with the uppercase prefix "RF".
 * References that do not start with "RF" are national or proprietary references
 * and must NOT be checked with this algorithm.
 *
 * @param ref the full ISO 11649 reference string (e.g. "RF18539007547034")
 * @returns true if the check digits are valid, false otherwise
 */
export function isValidIso11649Ref(ref: string): boolean {
  if (ref.length < 5) {
    return false
  }
  // Rearrange: move first 4 chars (RF + 2 check digits) to the end, same as IBAN
  return mod97(ibanToNumeric(ref)) === 1
}

/**
 * Generates a valid IBAN checksum for a country code and BBAN.
 * Used in tests / arbitraries to create valid IBANs.
 *
 * @param countryCode two-letter ISO country code (e.g. "DE")
 * @param bban basic bank account number, alphanumeric, padded to the correct length
 * @returns the full IBAN string with correct check digits
 */
export function buildIban(countryCode: string, bban: string): string {
  // Placeholder check digits
  const provisional = countryCode + '00' + bban
  const numeric = ibanToNumeric(provisional)
  const checkDigits = 98 - mod97(numeric)
  const digits = checkDigits.toString().padStart(2, '0')
  return countryCode + digits + bban
}
