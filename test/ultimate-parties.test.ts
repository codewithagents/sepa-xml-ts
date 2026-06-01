/**
 * Unit tests for ultimate party (UltmtDbtr / UltmtCdtr) support.
 *
 * Scope: pain.001.001.09 and pain.008.001.08 only. Legacy and DK variants must
 * throw if an ultimate party is present (fail loud, never silently drop data).
 */

import { describe, it, expect } from 'vitest'
import { writeCreditTransfer } from '../src/writer/writer.js'
import { writeDirectDebit } from '../src/writer/direct-debit.js'
import { parse } from '../src/parser/parser.js'
import { validateXsd } from '../src/xsd.js'
import { UltimatePartySchema, euros } from '../src/model/schema.js'
import type { CreditTransferDocument } from '../src/model/schema.js'
import type { DirectDebitDocument } from '../src/model/pain008.js'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function baseCt(opts?: {
  ultimateDebtor?: { name: string }
  ultimateCreditor?: { name: string }
}): CreditTransferDocument {
  return {
    messageId: 'MSG-ULT-001',
    createdAt: '2026-01-01T10:00:00Z',
    initiatingParty: 'Test Corp',
    batches: [
      {
        id: 'BATCH-001',
        executionDate: '2026-01-15',
        debtor: {
          name: 'Test Corp',
          iban: 'DE89370400440532013000',
          bic: 'COBADEFFXXX',
        },
        transfers: [
          {
            endToEndId: 'E2E-001',
            amount: euros('42.00'),
            ...(opts?.ultimateDebtor !== undefined ? { ultimateDebtor: opts.ultimateDebtor } : {}),
            creditor: {
              name: 'Vendor GmbH',
              iban: 'NL91ABNA0417164300',
              bic: 'INGBNL2AXXX',
            },
            ...(opts?.ultimateCreditor !== undefined
              ? { ultimateCreditor: opts.ultimateCreditor }
              : {}),
          },
        ],
      },
    ],
  }
}

function baseSdd(opts?: {
  ultimateCreditor?: { name: string }
  ultimateDebtor?: { name: string }
}): DirectDebitDocument {
  return {
    messageId: 'SDD-ULT-001',
    createdAt: '2026-01-01T10:00:00Z',
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
        collectionDate: '2026-02-01',
        sequenceType: 'FRST',
        localInstrument: 'CORE',
        collections: [
          {
            endToEndId: 'SDD-E2E-001',
            amount: euros('55.00'),
            ...(opts?.ultimateCreditor !== undefined
              ? { ultimateCreditor: opts.ultimateCreditor }
              : {}),
            debtor: {
              name: 'Customer One',
              iban: 'DE65200400300234567000',
              bic: 'DEUTDEDBFRA',
            },
            ...(opts?.ultimateDebtor !== undefined ? { ultimateDebtor: opts.ultimateDebtor } : {}),
            mandate: {
              id: 'MAND-ULT-001',
              signatureDate: '2025-06-01',
            },
          },
        ],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// UltimatePartySchema validation
// ---------------------------------------------------------------------------

describe('UltimatePartySchema validation', () => {
  it('accepts a valid name (max 70 chars, SEPA charset)', () => {
    const result = UltimatePartySchema.safeParse({ name: 'Factoring AG' })
    expect(result.success).toBe(true)
  })

  it('rejects a name exceeding 70 characters', () => {
    const longName = 'A'.repeat(71)
    const result = UltimatePartySchema.safeParse({ name: longName })
    expect(result.success).toBe(false)
  })

  it('rejects an empty name', () => {
    const result = UltimatePartySchema.safeParse({ name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a name with a non-SEPA character (e.g. umlaut)', () => {
    const result = UltimatePartySchema.safeParse({ name: 'Muller und Sohne Überweisung' })
    expect(result.success).toBe(false)
  })

  it('accepts a name with allowed special chars (SEPA charset)', () => {
    const result = UltimatePartySchema.safeParse({ name: 'Party/Name-2 (OK)' })
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// pain.001.001.09: round-trip and XSD validity
// ---------------------------------------------------------------------------

describe('pain.001.001.09: ultimate party round-trip and XSD validity', () => {
  it('document without ultimate parties: round-trip is deep-equal', () => {
    const doc = baseCt()
    const xml = writeCreditTransfer(doc)
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    expect(parsed.type).toBe('pain.001')
    if (parsed.type !== 'pain.001') throw new Error('unexpected type')
    expect(parsed.data).toEqual(doc)
  })

  it('document without ultimate parties: no UltmtDbtr / UltmtCdtr elements in output', () => {
    const xml = writeCreditTransfer(baseCt())
    expect(xml).not.toContain('UltmtDbtr')
    expect(xml).not.toContain('UltmtCdtr')
  })

  it('document with ultimateDebtor: round-trip deep-equals original', () => {
    const doc = baseCt({ ultimateDebtor: { name: 'Factoring GmbH' } })
    const xml = writeCreditTransfer(doc)
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    expect(parsed.type).toBe('pain.001')
    if (parsed.type !== 'pain.001') throw new Error('unexpected type')
    expect(parsed.data).toEqual(doc)
  })

  it('document with ultimateCreditor: round-trip deep-equals original', () => {
    const doc = baseCt({ ultimateCreditor: { name: 'Final Beneficiary SA' } })
    const xml = writeCreditTransfer(doc)
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    expect(parsed.type).toBe('pain.001')
    if (parsed.type !== 'pain.001') throw new Error('unexpected type')
    expect(parsed.data).toEqual(doc)
  })

  it('document with both ultimateDebtor and ultimateCreditor: round-trip deep-equals original', () => {
    const doc = baseCt({
      ultimateDebtor: { name: 'Factoring GmbH' },
      ultimateCreditor: { name: 'Final Beneficiary SA' },
    })
    const xml = writeCreditTransfer(doc)
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    expect(parsed.type).toBe('pain.001')
    if (parsed.type !== 'pain.001') throw new Error('unexpected type')
    expect(parsed.data).toEqual(doc)
  })

  it('document with both ultimate parties: XSD-valid (pain.001.001.09)', async () => {
    const doc = baseCt({
      ultimateDebtor: { name: 'Factoring GmbH' },
      ultimateCreditor: { name: 'Final Beneficiary SA' },
    })
    const xml = writeCreditTransfer(doc)
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })

  it('UltmtDbtr appears after Amt and before CdtrAgt in the output', () => {
    const doc = baseCt({ ultimateDebtor: { name: 'Factoring GmbH' } })
    const xml = writeCreditTransfer(doc)
    const amtIdx = xml.indexOf('<Amt>')
    const ultDbtrIdx = xml.indexOf('<UltmtDbtr>')
    const cdtrAgtIdx = xml.indexOf('<CdtrAgt>')
    expect(amtIdx).toBeGreaterThan(-1)
    expect(ultDbtrIdx).toBeGreaterThan(amtIdx)
    expect(cdtrAgtIdx).toBeGreaterThan(ultDbtrIdx)
  })

  it('UltmtCdtr appears after CdtrAcct and before RmtInf in the output', () => {
    const doc = baseCt({
      ultimateCreditor: { name: 'Final Beneficiary SA' },
    })
    // Add remittanceInfo so we can check ordering against RmtInf
    const docWithRmt: CreditTransferDocument = {
      ...doc,
      batches: [
        {
          ...doc.batches[0]!,
          transfers: [
            {
              ...doc.batches[0]!.transfers[0]!,
              remittanceInfo: 'INV-2026-001',
            },
          ],
        },
      ],
    }
    const xml = writeCreditTransfer(docWithRmt)
    const cdtrAcctIdx = xml.indexOf('<CdtrAcct>')
    const ultCdtrIdx = xml.indexOf('<UltmtCdtr>')
    const rmtInfIdx = xml.indexOf('<RmtInf>')
    expect(cdtrAcctIdx).toBeGreaterThan(-1)
    expect(ultCdtrIdx).toBeGreaterThan(cdtrAcctIdx)
    expect(rmtInfIdx).toBeGreaterThan(ultCdtrIdx)
  })
})

// ---------------------------------------------------------------------------
// pain.008.001.08: round-trip and XSD validity
// ---------------------------------------------------------------------------

describe('pain.008.001.08: ultimate party round-trip and XSD validity', () => {
  it('document without ultimate parties: round-trip is deep-equal', () => {
    const doc = baseSdd()
    const xml = writeDirectDebit(doc)
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    expect(parsed.type).toBe('pain.008')
    if (parsed.type !== 'pain.008') throw new Error('unexpected type')
    expect(parsed.data).toEqual(doc)
  })

  it('document without ultimate parties: no UltmtCdtr / UltmtDbtr elements in output', () => {
    const xml = writeDirectDebit(baseSdd())
    expect(xml).not.toContain('UltmtCdtr')
    expect(xml).not.toContain('UltmtDbtr')
  })

  it('document with ultimateCreditor: round-trip deep-equals original', () => {
    const doc = baseSdd({ ultimateCreditor: { name: 'Ultimate Creditor Ltd' } })
    const xml = writeDirectDebit(doc)
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    expect(parsed.type).toBe('pain.008')
    if (parsed.type !== 'pain.008') throw new Error('unexpected type')
    expect(parsed.data).toEqual(doc)
  })

  it('document with ultimateDebtor: round-trip deep-equals original', () => {
    const doc = baseSdd({ ultimateDebtor: { name: 'On Behalf Of Them' } })
    const xml = writeDirectDebit(doc)
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    expect(parsed.type).toBe('pain.008')
    if (parsed.type !== 'pain.008') throw new Error('unexpected type')
    expect(parsed.data).toEqual(doc)
  })

  it('document with both ultimateCreditor and ultimateDebtor: round-trip deep-equals original', () => {
    const doc = baseSdd({
      ultimateCreditor: { name: 'Ultimate Creditor Ltd' },
      ultimateDebtor: { name: 'On Behalf Of Them' },
    })
    const xml = writeDirectDebit(doc)
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    expect(parsed.type).toBe('pain.008')
    if (parsed.type !== 'pain.008') throw new Error('unexpected type')
    expect(parsed.data).toEqual(doc)
  })

  it('document with both ultimate parties: XSD-valid (pain.008.001.08)', async () => {
    const doc = baseSdd({
      ultimateCreditor: { name: 'Ultimate Creditor Ltd' },
      ultimateDebtor: { name: 'On Behalf Of Them' },
    })
    const xml = writeDirectDebit(doc)
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })

  it('UltmtCdtr appears after DrctDbtTx and before DbtrAgt in the output', () => {
    const doc = baseSdd({ ultimateCreditor: { name: 'Ultimate Creditor Ltd' } })
    const xml = writeDirectDebit(doc)
    const drctDbtTxIdx = xml.indexOf('<DrctDbtTx>')
    const ultCdtrIdx = xml.indexOf('<UltmtCdtr>')
    const dbtrAgtIdx = xml.indexOf('<DbtrAgt>')
    expect(drctDbtTxIdx).toBeGreaterThan(-1)
    expect(ultCdtrIdx).toBeGreaterThan(drctDbtTxIdx)
    expect(dbtrAgtIdx).toBeGreaterThan(ultCdtrIdx)
  })

  it('UltmtDbtr appears after DbtrAcct and before RmtInf in the output', () => {
    const doc = baseSdd({ ultimateDebtor: { name: 'On Behalf Of Them' } })
    // Add remittanceInfo to check ordering against RmtInf
    const docWithRmt: DirectDebitDocument = {
      ...doc,
      batches: [
        {
          ...doc.batches[0]!,
          collections: [
            {
              ...doc.batches[0]!.collections[0]!,
              remittanceInfo: 'Sub-2026-001',
            },
          ],
        },
      ],
    }
    const xml = writeDirectDebit(docWithRmt)
    const dbtrAcctIdx = xml.indexOf('<DbtrAcct>')
    const ultDbtrIdx = xml.indexOf('<UltmtDbtr>')
    const rmtInfIdx = xml.indexOf('<RmtInf>')
    expect(dbtrAcctIdx).toBeGreaterThan(-1)
    expect(ultDbtrIdx).toBeGreaterThan(dbtrAcctIdx)
    expect(rmtInfIdx).toBeGreaterThan(ultDbtrIdx)
  })
})

// ---------------------------------------------------------------------------
// Fail-loud: legacy and DK variants must throw when ultimate parties are present
// ---------------------------------------------------------------------------

describe('fail-loud: ultimate party is not supported for legacy/DK variants', () => {
  it('writeCreditTransfer with variant=pain.001.001.03 throws if ultimateDebtor is present', () => {
    const doc = baseCt({ ultimateDebtor: { name: 'Factoring GmbH' } })
    expect(() => writeCreditTransfer(doc, { variant: 'pain.001.001.03' })).toThrow(
      'ultimate party is not yet supported for variant pain.001.001.03'
    )
  })

  it('writeCreditTransfer with variant=pain.001.001.03 throws if ultimateCreditor is present', () => {
    const doc = baseCt({ ultimateCreditor: { name: 'Final Beneficiary SA' } })
    expect(() => writeCreditTransfer(doc, { variant: 'pain.001.001.03' })).toThrow(
      'ultimate party is not yet supported for variant pain.001.001.03'
    )
  })

  it('writeCreditTransfer with variant=pain.001.003.03 throws if ultimateDebtor is present', () => {
    const doc = baseCt({ ultimateDebtor: { name: 'Factoring GmbH' } })
    expect(() => writeCreditTransfer(doc, { variant: 'pain.001.003.03' })).toThrow(
      'ultimate party is not yet supported for variant pain.001.003.03'
    )
  })

  it('writeCreditTransfer with variant=pain.001.003.03 throws if ultimateCreditor is present', () => {
    const doc = baseCt({ ultimateCreditor: { name: 'Final Beneficiary SA' } })
    expect(() => writeCreditTransfer(doc, { variant: 'pain.001.003.03' })).toThrow(
      'ultimate party is not yet supported for variant pain.001.003.03'
    )
  })

  it('writeDirectDebit with variant=pain.008.003.02 throws if ultimateCreditor is present', () => {
    const doc = baseSdd({ ultimateCreditor: { name: 'Ultimate Creditor Ltd' } })
    expect(() => writeDirectDebit(doc, { variant: 'pain.008.003.02' })).toThrow(
      'ultimate party is not yet supported for variant pain.008.003.02'
    )
  })

  it('writeDirectDebit with variant=pain.008.003.02 throws if ultimateDebtor is present', () => {
    const doc = baseSdd({ ultimateDebtor: { name: 'On Behalf Of Them' } })
    expect(() => writeDirectDebit(doc, { variant: 'pain.008.003.02' })).toThrow(
      'ultimate party is not yet supported for variant pain.008.003.02'
    )
  })
})
