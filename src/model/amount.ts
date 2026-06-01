/**
 * Internal amount helpers for SEPA XML writing.
 *
 * Public Money type, euros(), and formatMoney() live in schema.ts.
 * This file provides internal formatting utilities for the writer.
 */

import type { Money } from "./schema.js";

/**
 * Format a Money value to the XML decimal string.
 * Result always has exactly 2 decimal places.
 * This is the internal writer helper; the public-facing formatMoney is in schema.ts.
 *
 * @param m the Money value
 * @returns formatted string like "100.50"
 */
export function formatAmountForXml(m: Money): string {
  const whole = m.minorUnits / 100n;
  const cents = m.minorUnits % 100n;
  return `${whole}.${cents.toString().padStart(2, "0")}`;
}

/**
 * Sum an array of Money values without any floating-point risk.
 * All values must be EUR (the schema guarantees this).
 */
export function sumMoney(amounts: readonly Money[]): bigint {
  return amounts.reduce((acc, m) => acc + m.minorUnits, 0n);
}
