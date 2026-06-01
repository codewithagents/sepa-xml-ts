/**
 * Amount handling for SEPA payments.
 *
 * Amounts are represented as integer minor units (cents) to avoid floating-point issues.
 * Format for XML: exactly 2 decimal places, dot separator, no thousands grouping.
 *
 * Example: 10050 (minor units) -> "100.50"
 */

/** Minimum allowed amount in minor units (0.01 EUR = 1 cent). */
export const MIN_AMOUNT_MINOR = 1n;

/** Maximum amount: 18 digits total, 5 fraction digits per XSD. We enforce 2 decimals. */
export const MAX_AMOUNT_MINOR = 999_999_999_999_999_99n; // 999 trillion + cents

/**
 * Formats an amount from integer minor units (cents) to the XML decimal string.
 * Result always has exactly 2 decimal places.
 *
 * @param minorUnits integer number of cents (must be >= 0)
 * @returns formatted string like "100.50"
 */
export function formatAmount(minorUnits: bigint): string {
  if (minorUnits < 0n) {
    throw new Error(`Amount must not be negative, got: ${minorUnits}`);
  }
  const euros = minorUnits / 100n;
  const cents = minorUnits % 100n;
  return `${euros}.${cents.toString().padStart(2, "0")}`;
}

/**
 * Sum an array of bigint amounts without any floating-point risk.
 */
export function sumAmounts(amounts: readonly bigint[]): bigint {
  return amounts.reduce((acc, val) => acc + val, 0n);
}
