/**
 * Tests for the typed message-type and variant constants.
 *
 * Covers:
 * - MessageType.CreditTransfer === "pain.001" (value equality)
 * - MessageType.DirectDebit === "pain.008" (value equality)
 * - parse() discriminator narrows correctly when compared with MessageType constants
 * - writeCreditTransfer accepts both the constant and the raw string for variant
 * - writeDirectDebit accepts both the constant and the raw string for variant
 * - CreditTransferVariant and DirectDebitVariant const values match their string equivalents
 * - Constants work correctly in the round-trip (value === discriminator literal)
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import { writeCreditTransfer } from '../src/writer/writer.js'
import { writeDirectDebit } from '../src/writer/direct-debit.js'
import { parse } from '../src/parser/parser.js'
import { euros } from '../src/model/schema.js'
import { MessageType, CreditTransferVariant, DirectDebitVariant } from '../src/message-types.js'
import type { CreditTransferDocument } from '../src/model/schema.js'
import type { DirectDebitDocument } from '../src/model/pain008.js'
import type { ParseSuccess001, ParseSuccess008 } from '../src/parser/parser.js'

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

const minimalCt: CreditTransferDocument = {
  messageId: 'MSG-CT-CONST-001',
  createdAt: '2026-01-01T10:00:00Z',
  initiatingParty: 'Test Corp',
  batches: [
    {
      id: 'BATCH-001',
      executionDate: '2026-01-15',
      debtor: { name: 'Test Corp', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' },
      transfers: [
        {
          endToEndId: 'E2E-001',
          amount: euros('12.34'),
          creditor: { name: 'Vendor', iban: 'NL91ABNA0417164300' },
        },
      ],
    },
  ],
}

const minimalDd: DirectDebitDocument = {
  messageId: 'MSG-DD-CONST-001',
  createdAt: '2026-01-01T10:00:00Z',
  initiatingParty: 'Test Corp',
  creditor: {
    name: 'Test Corp',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX',
    creditorId: 'DE98ZZZ09999999999',
  },
  batches: [
    {
      id: 'BATCH-DD-001',
      collectionDate: '2026-01-20',
      sequenceType: 'FRST',
      collections: [
        {
          endToEndId: 'E2E-DD-001',
          amount: euros('10.00'),
          debtor: { name: 'Debtor One', iban: 'DE65200400300234567000' },
          mandate: { id: 'MND-001', signatureDate: '2025-12-01' },
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// MessageType constant values
// ---------------------------------------------------------------------------

describe('MessageType constants', () => {
  it('MessageType.CreditTransfer equals the raw string "pain.001"', () => {
    expect(MessageType.CreditTransfer).toBe('pain.001')
  })

  it('MessageType.DirectDebit equals the raw string "pain.008"', () => {
    expect(MessageType.DirectDebit).toBe('pain.008')
  })

  it('both values are distinct', () => {
    expect(MessageType.CreditTransfer).not.toBe(MessageType.DirectDebit)
  })
})

// ---------------------------------------------------------------------------
// CreditTransferVariant constant values
// ---------------------------------------------------------------------------

describe('CreditTransferVariant constants', () => {
  it('SCT_V09 equals "pain.001.001.09"', () => {
    expect(CreditTransferVariant.SCT_V09).toBe('pain.001.001.09')
  })

  it('SCT_Legacy equals "pain.001.001.03"', () => {
    expect(CreditTransferVariant.SCT_Legacy).toBe('pain.001.001.03')
  })

  it('SCT_DK equals "pain.001.003.03"', () => {
    expect(CreditTransferVariant.SCT_DK).toBe('pain.001.003.03')
  })
})

// ---------------------------------------------------------------------------
// DirectDebitVariant constant values
// ---------------------------------------------------------------------------

describe('DirectDebitVariant constants', () => {
  it('SDD_V08 equals "pain.008.001.08"', () => {
    expect(DirectDebitVariant.SDD_V08).toBe('pain.008.001.08')
  })

  it('SDD_DK equals "pain.008.003.02"', () => {
    expect(DirectDebitVariant.SDD_DK).toBe('pain.008.003.02')
  })
})

// ---------------------------------------------------------------------------
// parse() discriminator and MessageType narrowing
// ---------------------------------------------------------------------------

describe('parse discriminator and MessageType narrowing', () => {
  it('parsed pain.001 result.type equals MessageType.CreditTransfer', () => {
    const xml = writeCreditTransfer(minimalCt)
    const result = parse(xml)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.type).toBe(MessageType.CreditTransfer)
    // Also verify the raw string still works for comparison
    expect(result.type).toBe('pain.001')
  })

  it('parsed pain.008 result.type equals MessageType.DirectDebit', () => {
    const xml = writeDirectDebit(minimalDd)
    const result = parse(xml)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.type).toBe(MessageType.DirectDebit)
    // Also verify the raw string still works for comparison
    expect(result.type).toBe('pain.008')
  })

  it('narrowing with MessageType constant gives access to CreditTransferDocument', () => {
    const xml = writeCreditTransfer(minimalCt)
    const result = parse(xml)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    if (result.type === MessageType.CreditTransfer) {
      // TypeScript narrows to ParseSuccess001, so .data is CreditTransferDocument
      expect(result.data.messageId).toBe('MSG-CT-CONST-001')
    } else {
      throw new Error('Expected credit transfer result')
    }
  })

  it('narrowing with MessageType constant gives access to DirectDebitDocument', () => {
    const xml = writeDirectDebit(minimalDd)
    const result = parse(xml)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    if (result.type === MessageType.DirectDebit) {
      // TypeScript narrows to ParseSuccess008, so .data is DirectDebitDocument
      expect(result.data.messageId).toBe('MSG-DD-CONST-001')
    } else {
      throw new Error('Expected direct debit result')
    }
  })
})

// ---------------------------------------------------------------------------
// writeCreditTransfer: constant vs raw string produce the same output
// ---------------------------------------------------------------------------

describe('writeCreditTransfer: constant and raw string produce identical output', () => {
  it('constant CreditTransferVariant.SCT_V09 produces same XML as raw string', () => {
    const byConst = writeCreditTransfer(minimalCt, { variant: CreditTransferVariant.SCT_V09 })
    const byString = writeCreditTransfer(minimalCt, { variant: 'pain.001.001.09' })
    expect(byConst).toBe(byString)
  })

  it('constant CreditTransferVariant.SCT_Legacy produces same XML as raw string', () => {
    const byConst = writeCreditTransfer(minimalCt, { variant: CreditTransferVariant.SCT_Legacy })
    const byString = writeCreditTransfer(minimalCt, { variant: 'pain.001.001.03' })
    expect(byConst).toBe(byString)
  })

  it('constant CreditTransferVariant.SCT_DK produces same XML as raw string', () => {
    const byConst = writeCreditTransfer(minimalCt, { variant: CreditTransferVariant.SCT_DK })
    const byString = writeCreditTransfer(minimalCt, { variant: 'pain.001.003.03' })
    expect(byConst).toBe(byString)
  })
})

// ---------------------------------------------------------------------------
// writeDirectDebit: constant vs raw string produce the same output
// ---------------------------------------------------------------------------

describe('writeDirectDebit: constant and raw string produce identical output', () => {
  it('constant DirectDebitVariant.SDD_V08 produces same XML as raw string', () => {
    const byConst = writeDirectDebit(minimalDd, { variant: DirectDebitVariant.SDD_V08 })
    const byString = writeDirectDebit(minimalDd, { variant: 'pain.008.001.08' })
    expect(byConst).toBe(byString)
  })

  it('constant DirectDebitVariant.SDD_DK produces same XML as raw string', () => {
    const byConst = writeDirectDebit(minimalDd, { variant: DirectDebitVariant.SDD_DK })
    const byString = writeDirectDebit(minimalDd, { variant: 'pain.008.003.02' })
    expect(byConst).toBe(byString)
  })
})

// ---------------------------------------------------------------------------
// Type-level: ParseSuccess types are assignable to MessageType literal
// ---------------------------------------------------------------------------

describe('ParseSuccess type assignability', () => {
  it('ParseSuccess001.type is assignable to MessageType', () => {
    // This is a compile-time check via expectTypeOf.
    // If MessageType changed from 'pain.001', this assertion would fail at type-check.
    expectTypeOf<ParseSuccess001['type']>().toEqualTypeOf<typeof MessageType.CreditTransfer>()
  })

  it('ParseSuccess008.type is assignable to MessageType', () => {
    expectTypeOf<ParseSuccess008['type']>().toEqualTypeOf<typeof MessageType.DirectDebit>()
  })
})
