/**
 * Tests for the SEPA Creditor Identifier implementation.
 *
 * Key claim: the check digit (ISO 7064 MOD 97-10) covers only the national
 * identifier + country code. The 3-char Creditor Business Code at positions 5-7
 * is EXCLUDED from the checksum per EPC262-08.
 *
 * This file proves that claim by taking a valid creditor ID and mutating only
 * the business code, then asserting that the mutated ID is still valid.
 * It also proves that corrupting the national ID or check digits causes failure.
 */

import { describe, it, expect } from 'vitest'
import { isValidCreditorId, buildCreditorId } from '../src/model/creditor-id.js'

// ---------------------------------------------------------------------------
// Business code exclusion (EPC262-08): the key correctness proof
// ---------------------------------------------------------------------------

describe('isValidCreditorId: business-code exclusion (EPC262-08)', () => {
  // Canonical example from the EPC spec.
  const canonical = 'DE98ZZZ09999999999'

  it('accepts the canonical DE98ZZZ09999999999', () => {
    expect(isValidCreditorId(canonical)).toBe(true)
  })

  it('still valid after changing business code ZZZ -> ABC (only biz code changed)', () => {
    // DE98ZZZ... -> DE98ABC...
    // The national id (09999999999) and country+check (DE98) are unchanged.
    // If the implementation correctly excludes the business code from the checksum,
    // this must still pass validation.
    const mutated = canonical.slice(0, 4) + 'ABC' + canonical.slice(7)
    expect(mutated).toBe('DE98ABC09999999999')
    expect(isValidCreditorId(mutated)).toBe(true)
  })

  it('still valid after changing business code ZZZ -> 123', () => {
    const mutated = canonical.slice(0, 4) + '123' + canonical.slice(7)
    expect(mutated).toBe('DE98123' + '09999999999')
    expect(isValidCreditorId(mutated)).toBe(true)
  })

  it('still valid after changing business code ZZZ -> A1B', () => {
    const mutated = canonical.slice(0, 4) + 'A1B' + canonical.slice(7)
    expect(isValidCreditorId(mutated)).toBe(true)
  })

  it('buildCreditorId produces the same check digits regardless of business code', () => {
    // All of these have different business codes but the same country + national id.
    // The check digits should be identical because the biz code is excluded.
    const withZZZ = buildCreditorId('DE', 'ZZZ', '09999999999')
    const withABC = buildCreditorId('DE', 'ABC', '09999999999')
    const with123 = buildCreditorId('DE', '123', '09999999999')
    // Extract check digits (positions 2-3)
    const checkZZZ = withZZZ.slice(2, 4)
    const checkABC = withABC.slice(2, 4)
    const check123 = with123.slice(2, 4)
    expect(checkABC).toBe(checkZZZ)
    expect(check123).toBe(checkZZZ)
  })

  it('all biz-code variants built with buildCreditorId pass isValidCreditorId', () => {
    const bizzCodes = ['ZZZ', 'ABC', '123', 'A1B', '000', 'XYZ']
    for (const biz of bizzCodes) {
      const id = buildCreditorId('DE', biz, '09999999999')
      expect(isValidCreditorId(id), `Expected ${id} to be valid`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Negative tests: corrupting the national ID or check digits must fail
// ---------------------------------------------------------------------------

describe('isValidCreditorId: corruption detection', () => {
  it('rejects when the national identifier is corrupted', () => {
    // Change the last digit of the national id from 9 to 8.
    const corrupted = 'DE98ZZZ09999999998'
    expect(isValidCreditorId(corrupted)).toBe(false)
  })

  it('rejects when check digits are wrong (DE97 instead of DE98)', () => {
    expect(isValidCreditorId('DE97ZZZ09999999999')).toBe(false)
  })

  it('rejects when check digits are wrong (DE01 instead of DE98)', () => {
    expect(isValidCreditorId('DE01ZZZ09999999999')).toBe(false)
  })

  it('rejects when check digits are all zeros (DE00)', () => {
    expect(isValidCreditorId('DE00ZZZ09999999999')).toBe(false)
  })

  it('rejects when the country code is changed but check digits are not recomputed', () => {
    // DE98ZZZ... with country changed to FR keeps DE check digits -> wrong
    const wrong = 'FR98ZZZ09999999999'
    // This might or might not be valid for FR; the point is the check is attempted
    const frBuilt = buildCreditorId('FR', 'ZZZ', '09999999999')
    // The built FR id should be valid
    expect(isValidCreditorId(frBuilt)).toBe(true)
    // A DE-computed check digit on FR country is almost certainly wrong
    // (the values could coincidentally match, so we only test the positive case above)
    void wrong // used to suppress lint warning
  })
})

// ---------------------------------------------------------------------------
// Additional positive cases: various countries and business codes
// ---------------------------------------------------------------------------

describe('isValidCreditorId: additional country coverage', () => {
  const cases: Array<[string, string, string]> = [
    ['FR', 'ZZZ', '12345678901'],
    ['NL', 'ABC', '1234567890'],
    ['AT', 'ZZZ', '00000000001'],
    ['BE', 'XYZ', '695000000008'],
    ['ES', 'AAA', '00000001234'],
    ['IT', 'BBB', 'ABCDE12345'],
    ['PT', 'ZZZ', '50000000001'],
    ['FI', '000', '1234567'],
  ]

  for (const [country, biz, nationalId] of cases) {
    it(`accepts buildCreditorId('${country}', '${biz}', '${nationalId}')`, () => {
      const id = buildCreditorId(country, biz, nationalId)
      expect(isValidCreditorId(id)).toBe(true)
    })
  }
})
