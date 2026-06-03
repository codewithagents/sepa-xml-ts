/**
 * Shared fast-check arbitraries for sepa-xml-ts property tests.
 *
 * Extracted from xsd-oracle.test.ts and iso003-variant.test.ts to eliminate
 * copy-pasted definitions that diverged and caused flakes. The canonical
 * arbSepaIdentifier uses the correct filter-based implementation (not a
 * map-based one) so shrinking never produces a slash-violating value.
 *
 * Import convention: use './arbitraries.js' (NodeNext ESM, .js extension).
 */

import * as fc from 'fast-check'
import { buildIban } from '../src/model/iban.js'
import { sanitizeSepa } from '../src/model/charset.js'
import type { PostalAddress } from '../src/model/schema.js'

// ---------------------------------------------------------------------------
// IBAN helpers
// ---------------------------------------------------------------------------

/**
 * Countries with BBAN structures that fit [a-zA-Z0-9]{1,30}.
 * Each entry: [countryCode, bbanLength] where all digits are used (simple).
 */
const IBAN_COUNTRIES: Array<[string, number]> = [
  ['DE', 18],
  ['FR', 23],
  ['NL', 14],
  ['ES', 20],
  ['IT', 23],
  ['AT', 16],
  ['BE', 12],
  ['PT', 21],
  ['FI', 14],
  ['LU', 16],
]

/** Arbitrary that produces a valid IBAN (passes mod-97 checksum). */
export function arbIban(): fc.Arbitrary<string> {
  return fc.integer({ min: 0, max: IBAN_COUNTRIES.length - 1 }).chain((idx) => {
    const entry = IBAN_COUNTRIES[idx]
    if (entry === undefined) {
      throw new Error(`IBAN_COUNTRIES index out of range: ${idx}`)
    }
    const [country, bbanLen] = entry
    return fc
      .array(fc.integer({ min: 0, max: 9 }), { minLength: bbanLen, maxLength: bbanLen })
      .map((digits) => {
        const bban = digits.join('')
        return buildIban(country, bban)
      })
  })
}

// ---------------------------------------------------------------------------
// SEPA text helpers
// ---------------------------------------------------------------------------

const SEPA_CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /-?:().,'+"

/** Arbitrary for a clean SEPA text string of the given max length. */
export function arbSepaText(minLen: number, maxLen: number): fc.Arbitrary<string> {
  return fc
    .string({
      unit: fc.constantFrom(...SEPA_CHARSET.split('')),
      minLength: minLen,
      maxLength: maxLen,
    })
    .map((s) => s.trim())
    .filter((s) => s.length >= minLen)
}

/**
 * Arbitrary for a SEPA identifier string: SEPA charset PLUS EPC slash rules.
 * Must not start or end with '/' and must not contain '//'.
 * Used for MsgId, PmtInfId, and EndToEndId fields.
 *
 * Uses a filter (not a map) so the constraint holds by construction: no amount
 * of shrinking can produce a slash-violating value that slips through.
 */
export function arbSepaIdentifier(minLen: number, maxLen: number): fc.Arbitrary<string> {
  return arbSepaText(minLen, maxLen).filter(
    (s) => !s.startsWith('/') && !s.endsWith('/') && !s.includes('//')
  )
}

/**
 * Arbitrary for text that may contain unicode/extended chars but
 * gets sanitized through sanitizeSepa before use.
 *
 * Uses a wider character set including full Latin-1 Supplement, emoji, and
 * a small CJK sample to stress the drop-and-transliterate path.
 */
function arbSanitizedSepaText(minLen: number, maxLen: number): fc.Arbitrary<string> {
  const extendedLatin = 'äöüÄÖÜßàáâãåæèéêëìíîïðñòóôõøùúûýÿÀÁÂÃÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕØÙÚÛÝþÞçÇ'
  const droppedSamples = '🎉🥳🌍你好مرحباПривет'
  const mixedCharset = SEPA_CHARSET + extendedLatin + droppedSamples
  return fc
    .string({
      unit: fc.constantFrom(...[...mixedCharset]),
      minLength: minLen + 5,
      maxLength: maxLen + 20,
    })
    .map((s) => sanitizeSepa(s))
    .filter((s) => s.length >= minLen && s.length <= maxLen)
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function arbCreatedAt(): fc.Arbitrary<string> {
  return fc
    .record({
      year: fc.integer({ min: 2020, max: 2035 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 0, max: 59 }),
      second: fc.integer({ min: 0, max: 59 }),
    })
    .map(
      ({ year, month, day, hour, minute, second }) =>
        `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}` +
        `T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}Z`
    )
}

export function arbDate(): fc.Arbitrary<string> {
  return fc
    .record({
      year: fc.integer({ min: 2024, max: 2035 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
    })
    .map(
      ({ year, month, day }) =>
        `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    )
}

// ---------------------------------------------------------------------------
// Party helpers
// ---------------------------------------------------------------------------

export function arbPartyName(): fc.Arbitrary<string> {
  return fc.oneof(arbSepaText(1, 70), arbSanitizedSepaText(1, 70))
}

export function arbBic(): fc.Arbitrary<string> {
  return fc.constantFrom('COBADEFFXXX', 'BNPAFRPPXXX', 'DEUTDEDBFRA', 'INGBNL2AXXX', 'BSCHESMMXXX')
}

// ---------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------

/**
 * EPC AT-06 cap: 999,999,999.99 EUR = 99,999,999,999 cents.
 * All boundary values must be at or below this cap.
 */
const MAX_AMOUNT_MINOR = 99_999_999_999n

export function arbMoney(): fc.Arbitrary<{ currencyCode: 'EUR'; minorUnits: bigint }> {
  return fc.oneof(
    // Boundary: minimum (0.01 EUR = 1 cent)
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: 1n }),
    // Boundary: just below 1 EUR
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: 99n }),
    // Boundary: exactly 1 EUR
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: 100n }),
    // Boundary: 1000 EUR
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: 100_000n }),
    // Boundary: large amount (near float precision boundary for naive implementations)
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: 999_999_999n }),
    // Boundary: at the EPC AT-06 cap (999,999,999.99 EUR)
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: MAX_AMOUNT_MINOR }),
    // Boundary: one cent below the cap
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: MAX_AMOUNT_MINOR - 1n }),
    // Random amounts between 1 cent and the EPC AT-06 cap
    fc
      .bigInt({ min: 1n, max: MAX_AMOUNT_MINOR })
      .map((n) => ({ currencyCode: 'EUR' as const, minorUnits: n }))
  )
}

// ---------------------------------------------------------------------------
// Postal address helpers
// ---------------------------------------------------------------------------

/**
 * Arbitrary for an optional structured PostalAddress (PstlAdr).
 * Each field is independently optional; the result always has at least one field
 * set (an empty address object is invalid). All text uses the trimmed SEPA charset
 * so it survives the XML round-trip; country is a valid 2-letter code.
 *
 * This covers PostalAddress24 (pain.001.001.09, pain.008.001.08) and PostalAddress6
 * (pain.001.001.03): both use the same full field set and element order.
 */
export function arbPostalAddress(): fc.Arbitrary<PostalAddress> {
  return fc
    .record({
      streetName: fc.option(arbSepaText(1, 70), { nil: undefined }),
      buildingNumber: fc.option(arbSepaText(1, 16), { nil: undefined }),
      postCode: fc.option(arbSepaText(1, 16), { nil: undefined }),
      townName: fc.option(arbSepaText(1, 35), { nil: undefined }),
      countrySubDivision: fc.option(arbSepaText(1, 35), { nil: undefined }),
      country: fc.option(fc.constantFrom('DE', 'FR', 'NL', 'ES', 'IT', 'BE', 'AT'), {
        nil: undefined,
      }),
      addressLines: fc.option(fc.array(arbSepaText(1, 70), { minLength: 1, maxLength: 7 }), {
        nil: undefined,
      }),
    })
    .map((a) => {
      // Strip undefined keys so the generated model matches what the parser returns.
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(a)) {
        if (v !== undefined) out[k] = v
      }
      return out as PostalAddress
    })
    .filter((a) => Object.keys(a).length > 0)
}

/** Attach an optional address to a party record, stripping the key when absent. */
export function withOptionalAddress<T extends object>(
  party: T,
  address: PostalAddress | undefined
): T {
  if (address === undefined) return party
  return { ...party, address }
}
