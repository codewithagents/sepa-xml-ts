/**
 * Tests for IBAN minimum-length floor (issue #6) and lowercase rejection (issue #7).
 *
 * Covers:
 * - isValidIban: strings that are too short (< 15 chars total) now return false,
 *   even when they pass the old regex and happen to satisfy mod-97.
 * - isValidIban: a real, correctly-structured IBAN still returns true.
 * - IBANSchema (pain.001): lowercase body is rejected; uppercase equivalent passes.
 * - IBANSchema (pain.008, CreditorIdSchema): lowercase body is rejected.
 *
 * Deliberate non-goal: per-country length tables. The floor of 15 (BBAN >= 11)
 * is sufficient to catch degenerate fuzz inputs without risking false positives on
 * new or exotic country codes.
 */

import { describe, it, expect } from 'vitest'
import { isValidIban, buildIban } from '../src/model/iban.js'
import { validateCreditTransfer, validateDirectDebit } from '../src/model/validate.js'
import type { CreditTransferDocument } from '../src/model/schema.js'
import type { DirectDebitDocument } from '../src/model/pain008.js'

// ---------------------------------------------------------------------------
// isValidIban: minimum-length floor (#6)
// ---------------------------------------------------------------------------

describe('isValidIban: minimum-length floor (issue #6)', () => {
  it('rejects XX900 (5 chars total, below ISO 13616 minimum of 15)', () => {
    expect(isValidIban('XX900')).toBe(false)
  })

  it('rejects XX631 (5 chars total, below minimum)', () => {
    expect(isValidIban('XX631')).toBe(false)
  })

  it('rejects XX093 (5 chars total, below minimum)', () => {
    expect(isValidIban('XX093')).toBe(false)
  })

  it('rejects a 14-char IBAN (one below the floor)', () => {
    // DE format: DE + 2 check + 10 BBAN = 14 chars total (BBAN = 10 < 11 minimum)
    // Build with the real buildIban so check digits are valid; floor must still reject it.
    const short = buildIban('DE', '1234567890') // 10-digit BBAN -> 14 chars total
    expect(short).toHaveLength(14)
    expect(isValidIban(short)).toBe(false)
  })

  it('accepts a valid full-length German IBAN (22 chars)', () => {
    // DE89370400440532013000 is a well-known test IBAN used throughout this codebase.
    expect(isValidIban('DE89370400440532013000')).toBe(true)
  })

  it('accepts a valid 15-char IBAN (exactly at the floor)', () => {
    // 2 (CC) + 2 (check) + 11 (BBAN) = 15 chars: this is the minimum length.
    const atFloor = buildIban('XX', '12345678901') // 11-digit BBAN -> 15 chars total
    expect(atFloor).toHaveLength(15)
    expect(isValidIban(atFloor)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isValidIban: lowercase body rejection (#7)
// ---------------------------------------------------------------------------

describe('isValidIban: lowercase body rejection (issue #7)', () => {
  it('rejects a GB IBAN with a lowercase bank-code section', () => {
    // Build a valid GB IBAN using a letter-bearing BBAN, then lowercase the BBAN.
    // GB sort-code BBANs have 4 uppercase letters followed by 14 digits.
    const upperIban = buildIban('GB', 'WEST12345698765432') // 18-char BBAN -> 22 chars total
    const lowerIban = upperIban.slice(0, 4) + upperIban.slice(4).toLowerCase()
    // Sanity: the uppercase version must pass.
    expect(isValidIban(upperIban)).toBe(true)
    // The lowercase-body version must be rejected (not silently normalised).
    expect(isValidIban(lowerIban)).toBe(false)
  })

  it('accepts the uppercase equivalent of a GB IBAN', () => {
    const upperIban = buildIban('GB', 'WEST12345698765432')
    expect(isValidIban(upperIban)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// IBANSchema (pain.001): lowercase IBAN body rejected at schema level (#7)
// ---------------------------------------------------------------------------

// Minimal helper to wrap a single IBAN into a CreditTransferDocument so we can
// exercise IBANSchema validation via validateCreditTransfer.
function docWithDebtorIban(iban: string): CreditTransferDocument {
  return {
    messageId: 'HARDENING-001',
    createdAt: '2024-06-01T09:00:00Z',
    initiatingParty: 'Test Corp',
    batches: [
      {
        id: 'BATCH-001',
        executionDate: '2024-06-10',
        debtor: { name: 'Test Debtor', iban },
        transfers: [
          {
            endToEndId: 'E2E-001',
            amount: { currencyCode: 'EUR', minorUnits: 100n },
            creditor: { name: 'Test Creditor', iban: 'DE89370400440532013000' },
          },
        ],
      },
    ],
  }
}

describe('IBANSchema (pain.001): lowercase body rejection via validateCreditTransfer (#7)', () => {
  it('rejects a GB IBAN whose bank-code section is lowercase', () => {
    const upperIban = buildIban('GB', 'WEST12345698765432')
    const lowerIban = upperIban.slice(0, 4) + upperIban.slice(4).toLowerCase()
    const result = validateCreditTransfer(docWithDebtorIban(lowerIban))
    expect(result.ok).toBe(false)
  })

  it('accepts the same GB IBAN in uppercase', () => {
    const upperIban = buildIban('GB', 'WEST12345698765432')
    const result = validateCreditTransfer(docWithDebtorIban(upperIban))
    expect(result.ok).toBe(true)
  })

  it('rejects a short IBAN (below 15 chars) via the document schema', () => {
    // buildIban with a 10-char BBAN produces a 14-char IBAN: below the new floor.
    const shortIban = buildIban('DE', '1234567890')
    const result = validateCreditTransfer(docWithDebtorIban(shortIban))
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// CreditorIdSchema (pain.008): lowercase national-identifier rejected (#7)
// ---------------------------------------------------------------------------

// Minimal helper: a valid DirectDebitDocument with a custom creditorId.
function docWithCreditorId(creditorId: string): DirectDebitDocument {
  return {
    messageId: 'HARDENING-DD-001',
    createdAt: '2024-06-01T09:00:00Z',
    initiatingParty: 'Test Corp',
    creditor: {
      name: 'Test Creditor',
      iban: 'DE89370400440532013000',
      bic: 'COBADEFFXXX',
      creditorId,
    },
    batches: [
      {
        id: 'BATCH-001',
        collectionDate: '2024-07-05',
        sequenceType: 'FRST',
        collections: [
          {
            endToEndId: 'SDD-E2E-001',
            amount: { currencyCode: 'EUR', minorUnits: 100n },
            debtor: { name: 'Test Debtor', iban: 'DE65200400300234567000' },
            mandate: { id: 'MAND-001', signatureDate: '2024-01-01' },
          },
        ],
      },
    ],
  }
}

describe('CreditorIdSchema (pain.008): lowercase national-identifier rejected (#7)', () => {
  it('accepts the canonical DE98ZZZ09999999999 (all uppercase)', () => {
    const result = validateDirectDebit(docWithCreditorId('DE98ZZZ09999999999'))
    expect(result.ok).toBe(true)
  })

  it('rejects a creditor id with a lowercase letter in the national identifier', () => {
    // DE98ZZZ0999999999a has a lowercase 'a' in the national id section.
    // The new regex [A-Z0-9]{1,28} must reject it rather than silently accept it.
    const lowerCred = 'DE98ZZZ0999999999a'
    const result = validateDirectDebit(docWithCreditorId(lowerCred))
    expect(result.ok).toBe(false)
  })

  it('rejects a creditor id with a lowercase letter in the business code', () => {
    // DE98ZzzABCDEFGHIJKL has a lowercase 'zz' in the business code.
    // [A-Z0-9]{3} already covered the biz code, but verifying the schema
    // rejects any lowercase in the entire national-id + business-code area.
    const lowerBizCode = 'DE98Zzz09999999999'
    const result = validateDirectDebit(docWithCreditorId(lowerBizCode))
    expect(result.ok).toBe(false)
  })
})
