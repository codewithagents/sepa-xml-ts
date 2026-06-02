/**
 * Tests for validateCreditTransfer and validateDirectDebit.
 *
 * Covers:
 * - Valid credit transfer document returns ok:true with parsed data
 * - Invalid credit transfer document (bad IBAN) returns ok:false with errors
 * - Valid direct debit document returns ok:true with parsed data
 * - Invalid direct debit document (bad IBAN) returns ok:false with errors
 * - Invalid direct debit document (bad creditorId check digit) returns ok:false with errors
 * - Invalid direct debit document (missing mandate) returns ok:false with errors
 * - Invalid direct debit document (amount below 0.01) returns ok:false with errors
 */

import { describe, it, expect } from 'vitest'
import { validateCreditTransfer, validateDirectDebit } from '../src/model/validate.js'
import type { CreditTransferDocument } from '../src/model/schema.js'
import type { DirectDebitDocument } from '../src/model/pain008.js'

// ---------------------------------------------------------------------------
// Valid fixtures
// ---------------------------------------------------------------------------

const validCreditTransfer: CreditTransferDocument = {
  messageId: 'VALIDATE-CT-001',
  createdAt: '2024-06-01T09:00:00Z',
  initiatingParty: 'Acme GmbH',
  batches: [
    {
      id: 'BATCH-001',
      executionDate: '2024-06-10',
      debtor: {
        name: 'Acme GmbH',
        iban: 'DE89370400440532013000',
        bic: 'COBADEFFXXX',
      },
      transfers: [
        {
          endToEndId: 'E2E-0001',
          amount: { currencyCode: 'EUR', minorUnits: 1500n },
          creditor: { name: 'Vendor One', iban: 'DE65200400300234567000' },
        },
      ],
    },
  ],
}

const validDirectDebit: DirectDebitDocument = {
  messageId: 'VALIDATE-DD-001',
  createdAt: '2024-06-01T09:00:00Z',
  initiatingParty: 'My Company GmbH',
  creditor: {
    name: 'My Company GmbH',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX',
    creditorId: 'DE98ZZZ09999999999',
  },
  batches: [
    {
      id: 'SDD-BATCH-001',
      collectionDate: '2024-07-05',
      sequenceType: 'FRST',
      localInstrument: 'CORE',
      collections: [
        {
          endToEndId: 'SDD-E2E-0001',
          amount: { currencyCode: 'EUR', minorUnits: 1000n },
          debtor: {
            name: 'Customer One',
            iban: 'DE65200400300234567000',
          },
          mandate: {
            id: 'MAND-0001',
            signatureDate: '2024-01-15',
          },
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// validateCreditTransfer
// ---------------------------------------------------------------------------

describe('validateCreditTransfer', () => {
  it('returns ok:true with parsed data for a valid credit transfer', () => {
    const result = validateCreditTransfer(validCreditTransfer)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true')
    expect(result.data.messageId).toBe('VALIDATE-CT-001')
    expect(result.data.batches).toHaveLength(1)
  })

  it('returns ok:false with errors for an invalid IBAN on debtor', () => {
    const bad = {
      ...validCreditTransfer,
      batches: [
        {
          ...validCreditTransfer.batches[0]!,
          debtor: {
            ...validCreditTransfer.batches[0]!.debtor,
            iban: 'DE00000000000000000000', // invalid checksum
          },
        },
      ],
    }
    const result = validateCreditTransfer(bad)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.errors.length).toBeGreaterThan(0)
    const messages = result.errors.map((e) => e.message).join(', ')
    expect(messages).toMatch(/IBAN/)
  })

  it('returns ok:false with errors for a completely invalid input', () => {
    const result = validateCreditTransfer({ not: 'a document' })
    expect(result.ok).toBe(false)
  })

  it('returns ok:false when batches array is empty', () => {
    const bad = { ...validCreditTransfer, batches: [] }
    const result = validateCreditTransfer(bad)
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// validateDirectDebit
// ---------------------------------------------------------------------------

describe('validateDirectDebit', () => {
  it('returns ok:true with parsed data for a valid direct debit', () => {
    const result = validateDirectDebit(validDirectDebit)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true')
    expect(result.data.messageId).toBe('VALIDATE-DD-001')
    expect(result.data.creditor.creditorId).toBe('DE98ZZZ09999999999')
  })

  it('returns ok:false with errors for an invalid debtor IBAN', () => {
    const bad: unknown = {
      ...validDirectDebit,
      batches: [
        {
          ...validDirectDebit.batches[0]!,
          collections: [
            {
              ...validDirectDebit.batches[0]!.collections[0]!,
              debtor: {
                ...validDirectDebit.batches[0]!.collections[0]!.debtor,
                iban: 'DE00000000000000000000', // invalid checksum
              },
            },
          ],
        },
      ],
    }
    const result = validateDirectDebit(bad)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.errors.length).toBeGreaterThan(0)
    const messages = result.errors.map((e) => e.message).join(', ')
    expect(messages).toMatch(/IBAN/)
  })

  it('returns ok:false with errors for a bad creditorId check digit', () => {
    const bad: unknown = {
      ...validDirectDebit,
      creditor: {
        ...validDirectDebit.creditor,
        creditorId: 'DE97ZZZ09999999999', // wrong check digit (should be 98)
      },
    }
    const result = validateDirectDebit(bad)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    const messages = result.errors.map((e) => e.message).join(', ')
    expect(messages).toMatch(/ISO 7064/)
  })

  it('returns ok:false with errors when mandate is missing on a collection', () => {
    const bad: unknown = {
      ...validDirectDebit,
      batches: [
        {
          ...validDirectDebit.batches[0]!,
          collections: [
            {
              endToEndId: 'SDD-E2E-0001',
              amount: { currencyCode: 'EUR', minorUnits: 1000n },
              debtor: {
                name: 'Customer One',
                iban: 'DE65200400300234567000',
              },
              // mandate is intentionally omitted
            },
          ],
        },
      ],
    }
    const result = validateDirectDebit(bad)
    expect(result.ok).toBe(false)
  })

  it('returns ok:false with errors when amount is below minimum (0 minorUnits)', () => {
    const bad: unknown = {
      ...validDirectDebit,
      batches: [
        {
          ...validDirectDebit.batches[0]!,
          collections: [
            {
              ...validDirectDebit.batches[0]!.collections[0]!,
              amount: { currencyCode: 'EUR', minorUnits: 0n }, // below minimum 1n (0.01 EUR)
            },
          ],
        },
      ],
    }
    const result = validateDirectDebit(bad)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('returns ok:false for a completely invalid input', () => {
    const result = validateDirectDebit({ not: 'a document' })
    expect(result.ok).toBe(false)
  })
})
