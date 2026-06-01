/**
 * IBAN validation using the mod-97 checksum algorithm.
 * Reference: ISO 13616 / EPC IBAN spec.
 */

/**
 * Rearranges an IBAN for mod-97 check:
 * move first 4 characters to the end, then replace letters with digits (A=10, B=11, ..., Z=35).
 */
function ibanToNumeric(iban: string): string {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let numeric = "";
  for (const ch of rearranged) {
    const code = ch.toUpperCase().charCodeAt(0);
    if (code >= 65 && code <= 90) {
      // A-Z => 10-35
      numeric += (code - 55).toString();
    } else {
      numeric += ch;
    }
  }
  return numeric;
}

/**
 * Compute mod 97 of a large integer represented as a string.
 * Uses chunked division to avoid floating-point issues.
 */
function mod97(numeric: string): number {
  let remainder = 0;
  for (const ch of numeric) {
    remainder = (remainder * 10 + parseInt(ch, 10)) % 97;
  }
  return remainder;
}

/**
 * Returns true if the IBAN passes the mod-97 checksum.
 * Does NOT check country-specific formats, only the checksum.
 */
export function isValidIban(iban: string): boolean {
  // Basic structural check first (matches XSD pattern)
  if (!/^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$/.test(iban)) {
    return false;
  }
  return mod97(ibanToNumeric(iban.toUpperCase())) === 1;
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
  const provisional = countryCode + "00" + bban;
  const numeric = ibanToNumeric(provisional);
  const checkDigits = 98 - mod97(numeric);
  const digits = checkDigits.toString().padStart(2, "0");
  return countryCode + digits + bban;
}
