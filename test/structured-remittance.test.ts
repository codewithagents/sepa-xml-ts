/**
 * Unit tests for structured remittance information (RmtInf/Strd/CdtrRefInf).
 *
 * Scope: pain.001.001.09 and pain.008.001.08 only. Legacy and DK variants must
 * throw if a structured remittance is present (fail loud, never silently drop).
 *
 * Validation policy (agreed): always SEPA charset + max length on the reference.
 * Conditionally validate ISO 11649 MOD 97-10 check digits ONLY when the reference
 * (trimmed) starts with the uppercase "RF" prefix. National / proprietary
 * references pass through unchecked. remittanceInfo (Ustrd) and
 * structuredRemittance (Strd) are mutually exclusive per the SEPA rulebook.
 */

import { describe, it, expect } from 'vitest'
import { writeCreditTransfer } from '../src/writer/writer.js'
import { writeDirectDebit } from '../src/writer/direct-debit.js'
import { parse } from '../src/parser/parser.js'
import { validateXsd } from '../src/xsd.js'
import { validateCreditTransfer } from '../src/model/validate.js'
import { StructuredRemittanceSchema, euros } from '../src/model/schema.js'
import { isValidIso11649Ref } from '../src/model/iban.js'
import type { CreditTransferDocument } from '../src/model/schema.js'
import type { DirectDebitDocument } from '../src/model/pain008.js'

// Canonical valid ISO 11649 example reference.
const VALID_RF = 'RF18539007547034'

function baseCt(remittanceOnTransfer?: Record<string, unknown>): CreditTransferDocument {
  return {
    messageId: 'MSG-RMT-001',
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
            amount: euros('10.00'),
            creditor: { name: 'Vendor', iban: 'NL91ABNA0417164300' },
            ...(remittanceOnTransfer ?? {}),
          },
        ],
      },
    ],
  } as CreditTransferDocument
}

function baseDd(remittanceOnCollection?: Record<string, unknown>): DirectDebitDocument {
  return {
    messageId: 'DD-RMT-001',
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
        id: 'SDD-BATCH-001',
        collectionDate: '2026-01-20',
        sequenceType: 'FRST',
        localInstrument: 'CORE',
        collections: [
          {
            endToEndId: 'SDD-E2E-001',
            amount: euros('10.00'),
            debtor: { name: 'Customer', iban: 'NL91ABNA0417164300' },
            mandate: { id: 'MAND-001', signatureDate: '2025-01-01' },
            ...(remittanceOnCollection ?? {}),
          },
        ],
      },
    ],
  } as DirectDebitDocument
}

describe('ISO 11649 reference check digit', () => {
  it('accepts the canonical valid RF reference', () => {
    expect(isValidIso11649Ref(VALID_RF)).toBe(true)
  })

  it('rejects an RF reference with wrong check digits', () => {
    // Same body, wrong check digits.
    expect(isValidIso11649Ref('RF19539007547034')).toBe(false)
  })
})

describe('StructuredRemittance schema validation', () => {
  it('accepts a valid RF reference', () => {
    expect(StructuredRemittanceSchema.safeParse({ creditorReference: VALID_RF }).success).toBe(true)
  })

  it('rejects an RF reference with invalid check digits', () => {
    expect(
      StructuredRemittanceSchema.safeParse({ creditorReference: 'RF19539007547034' }).success
    ).toBe(false)
  })

  it('passes through a non-RF national reference without a check-digit error', () => {
    // A Belgian-style structured reference, not ISO 11649.
    expect(
      StructuredRemittanceSchema.safeParse({ creditorReference: '539007547034' }).success
    ).toBe(true)
  })

  it('treats lowercase "rf..." as a non-RF reference (no check, passes)', () => {
    // The ISO 11649 prefix is uppercase. Lowercase is not an RF reference.
    expect(
      StructuredRemittanceSchema.safeParse({ creditorReference: 'rf19539007547034' }).success
    ).toBe(true)
  })

  it('rejects a reference longer than 35 chars', () => {
    expect(
      StructuredRemittanceSchema.safeParse({ creditorReference: 'A'.repeat(36) }).success
    ).toBe(false)
  })
})

describe('Structured remittance in pain.001.001.09', () => {
  it('round-trips with referenceType and issuer, and is XSD-valid', async () => {
    const sr = { creditorReference: VALID_RF, referenceType: 'SCOR', issuer: 'ISO' }
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: sr }))
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
    const r = parse(xml)
    if (!r.ok) throw new Error('parse failed')
    expect(r.data.batches[0]!.transfers[0]!.structuredRemittance).toEqual(sr)
  })

  it('defaults an omitted referenceType to SCOR on write, read back as SCOR', () => {
    const xml = writeCreditTransfer(
      baseCt({ structuredRemittance: { creditorReference: VALID_RF } })
    )
    expect(xml).toContain('<Cd>SCOR</Cd>')
    const r = parse(xml)
    if (!r.ok) throw new Error('parse failed')
    expect(r.data.batches[0]!.transfers[0]!.structuredRemittance).toEqual({
      creditorReference: VALID_RF,
      referenceType: 'SCOR',
    })
  })

  it('emits no Strd element when structuredRemittance is absent', () => {
    const xml = writeCreditTransfer(baseCt())
    expect(xml).not.toContain('<Strd>')
    expect(xml).not.toContain('<CdtrRefInf>')
  })

  it('still passes business validation after parse', () => {
    const r = parse(
      writeCreditTransfer(baseCt({ structuredRemittance: { creditorReference: VALID_RF } }))
    )
    if (!r.ok) throw new Error('parse failed')
    expect(validateCreditTransfer(r.data).ok).toBe(true)
  })
})

describe('Structured remittance in pain.008.001.08', () => {
  it('round-trips and is XSD-valid', async () => {
    const sr = { creditorReference: VALID_RF, referenceType: 'SCOR' }
    const xml = writeDirectDebit(baseDd({ structuredRemittance: sr }))
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
    const r = parse(xml)
    if (!r.ok) throw new Error('parse failed')
    expect(
      (r.data as DirectDebitDocument).batches[0]!.collections[0]!.structuredRemittance
    ).toEqual(sr)
  })
})

describe('Mutual exclusion of unstructured and structured remittance', () => {
  it('rejects a transfer with BOTH remittanceInfo and structuredRemittance', () => {
    const result = validateCreditTransfer(
      baseCt({ remittanceInfo: 'Invoice 1', structuredRemittance: { creditorReference: VALID_RF } })
    )
    expect(result.ok).toBe(false)
  })

  it('accepts a transfer with only remittanceInfo', () => {
    expect(validateCreditTransfer(baseCt({ remittanceInfo: 'Invoice 1' })).ok).toBe(true)
  })

  it('accepts a transfer with only structuredRemittance', () => {
    expect(
      validateCreditTransfer(baseCt({ structuredRemittance: { creditorReference: VALID_RF } })).ok
    ).toBe(true)
  })
})

describe('Structured remittance fail-loud on unsupported variants', () => {
  const sr = { structuredRemittance: { creditorReference: VALID_RF } }

  it('throws for pain.001.001.03', () => {
    expect(() => writeCreditTransfer(baseCt(sr), { variant: 'pain.001.001.03' })).toThrow(
      /structured remittance is not yet supported/
    )
  })

  it('throws for pain.001.003.03', () => {
    expect(() => writeCreditTransfer(baseCt(sr), { variant: 'pain.001.003.03' })).toThrow(
      /structured remittance is not yet supported/
    )
  })

  it('throws for pain.008.003.02', () => {
    expect(() => writeDirectDebit(baseDd(sr), { variant: 'pain.008.003.02' })).toThrow(
      /structured remittance is not yet supported/
    )
  })
})
