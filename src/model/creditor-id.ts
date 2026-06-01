/**
 * SEPA Creditor Identifier check-digit validation.
 *
 * Algorithm: ISO 7064 MOD 97-10, same family as IBAN.
 *
 * Structure of a SEPA Creditor Identifier (e.g. "DE98ZZZ09999999999"):
 *   - 2-char country code
 *   - 2 check digits
 *   - 3-char creditor business code (e.g. "ZZZ") -- NOT part of the checksum
 *   - national identifier (variable length, alphanumeric)
 *
 * Checksum computation steps:
 *   1. Strip the 3-char business code (chars at positions 4, 5, 6 in the full string).
 *   2. You are left with: countryCode (2) + checkDigits (2) + nationalId.
 *   3. Move the first 4 chars (CC + check digits) to the END:
 *        rearranged = nationalId + countryCode + checkDigits
 *   4. Replace each letter with its two-digit value (A=10 ... Z=35); digits stay as-is.
 *   5. Interpret the resulting string as a large integer and compute mod 97.
 *      Valid if and only if result === 1.
 */

/**
 * Convert a single alphanumeric character to its numeric representation.
 * Digits map to themselves; letters map as A=10 ... Z=35.
 */
function charToDigits(ch: string): string {
  const code = ch.toUpperCase().charCodeAt(0);
  if (code >= 65 && code <= 90) {
    // A-Z => 10-35
    return (code - 55).toString();
  }
  return ch;
}

/**
 * Compute mod 97 of a large integer represented as a decimal string.
 * Uses chunked division to avoid floating-point overflow.
 * Reuses the same approach as iban.ts.
 */
function mod97(numeric: string): number {
  let remainder = 0;
  for (const ch of numeric) {
    remainder = (remainder * 10 + parseInt(ch, 10)) % 97;
  }
  return remainder;
}

/**
 * Convert the check-relevant portion of a Creditor Identifier to a numeric string.
 *
 * Input: the full creditor ID string (e.g. "DE98ZZZ09999999999").
 * Steps:
 *   1. Extract: cc = id[0..1], checkDigits = id[2..3], nationalId = id[7..].
 *   2. Rearrange: nationalId + cc + checkDigits.
 *   3. Replace each letter with its digit representation.
 */
function creditorIdToNumeric(id: string): string {
  const cc = id.slice(0, 2);
  const checkDigits = id.slice(2, 4);
  // Skip business code (positions 4,5,6) per spec
  const nationalId = id.slice(7);
  const rearranged = nationalId + cc + checkDigits;
  let numeric = "";
  for (const ch of rearranged) {
    numeric += charToDigits(ch);
  }
  return numeric;
}

/**
 * Returns true if the SEPA Creditor Identifier has correct check digits.
 *
 * Strict ISO 7064 MOD 97-10: the check digits must equal the single canonical value
 * (always in the range 02..98) computed from the country code and national identifier.
 * A pure "mod 97 === 1" test would also accept the degenerate congruent alternate, since
 * e.g. 98 and 01 are congruent modulo 97; comparing against the canonical value rejects it.
 *
 * Does NOT validate country-specific national-id formats beyond the overall structure.
 *
 * @param id SEPA Creditor Identifier (e.g. "DE98ZZZ09999999999")
 */
export function isValidCreditorId(id: string): boolean {
  if (typeof id !== "string") {
    return false;
  }
  const up = id.toUpperCase();
  // Structure: 2 country letters, 2 check digits, 3-char business code, 1+ national id chars.
  if (up.length < 8 || up.length > 35) {
    return false;
  }
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{3}[A-Z0-9]+$/.test(up)) {
    return false;
  }
  const cc = up.slice(0, 2);
  const businessCode = up.slice(4, 7);
  const nationalId = up.slice(7);
  return buildCreditorId(cc, businessCode, nationalId) === up;
}

/**
 * Build a SEPA Creditor Identifier with correctly computed check digits.
 *
 * @param country two-letter ISO country code (e.g. "DE")
 * @param businessCode 3-char creditor business code (e.g. "ZZZ")
 * @param nationalId national identifier, alphanumeric, 1..28 chars
 * @returns full SEPA Creditor Identifier with correct check digits
 *
 * Example: buildCreditorId("DE", "ZZZ", "09999999999") === "DE98ZZZ09999999999"
 */
export function buildCreditorId(country: string, businessCode: string, nationalId: string): string {
  // Placeholder: CC + "00" + businessCode + nationalId
  const provisional = country.toUpperCase() + "00" + businessCode.toUpperCase() + nationalId.toUpperCase();
  const numeric = creditorIdToNumeric(provisional);
  const checkDigits = 98 - mod97(numeric);
  const digits = checkDigits.toString().padStart(2, "0");
  return country.toUpperCase() + digits + businessCode.toUpperCase() + nationalId.toUpperCase();
}
