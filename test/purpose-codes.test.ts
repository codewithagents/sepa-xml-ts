/**
 * Unit tests for purpose codes: Purp (transaction level) and CtgyPurp (batch level).
 *
 * Scope: pain.001.001.09 and pain.008.001.08 only. Legacy and DK variants must
 * throw if a purpose or categoryPurpose is present (fail loud, never drop silently).
 *
 * Validation policy (agreed): SEPA charset + length 1 to 4 only. We do NOT validate
 * against the ISO external code list (ExternalPurpose1Code / ExternalCategoryPurpose1Code),
 * which is published separately and updated quarterly. Validating membership would risk
 * false-positive rejections of valid-but-newer codes.
 */

import { describe, it, expect } from 'vitest'
import { writeCreditTransfer } from '../src/writer/writer.js'
import { writeDirectDebit } from '../src/writer/direct-debit.js'
import { parse } from '../src/parser/parser.js'
import { validateXsd } from '../src/xsd.js'
import { CreditTransferDocumentSchema, euros } from '../src/model/schema.js'
import type { CreditTransferDocument } from '../src/model/schema.js'
import type { DirectDebitDocument } from '../src/model/pain008.js'

function baseCt(opts?: { purpose?: string; categoryPurpose?: string }): CreditTransferDocument {
  return {
    messageId: 'MSG-PURP-001',
    createdAt: '2026-01-01T10:00:00Z',
    initiatingParty: 'Test Corp',
    batches: [
      {
        id: 'BATCH-001',
        executionDate: '2026-01-15',
        debtor: { name: 'Test Corp', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' },
        ...(opts?.categoryPurpose !== undefined ? { categoryPurpose: opts.categoryPurpose } : {}),
        transfers: [
          {
            endToEndId: 'E2E-001',
            amount: euros('10.00'),
            creditor: { name: 'Vendor', iban: 'NL91ABNA0417164300' },
            ...(opts?.purpose !== undefined ? { purpose: opts.purpose } : {}),
          },
        ],
      },
    ],
  } as CreditTransferDocument
}

function baseDd(opts?: { purpose?: string; categoryPurpose?: string }): DirectDebitDocument {
  return {
    messageId: 'DD-PURP-001',
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
        ...(opts?.categoryPurpose !== undefined ? { categoryPurpose: opts.categoryPurpose } : {}),
        collections: [
          {
            endToEndId: 'SDD-E2E-001',
            amount: euros('10.00'),
            debtor: { name: 'Customer', iban: 'NL91ABNA0417164300' },
            mandate: { id: 'MAND-001', signatureDate: '2025-01-01' },
            ...(opts?.purpose !== undefined ? { purpose: opts.purpose } : {}),
          },
        ],
      },
    ],
  } as DirectDebitDocument
}

describe('Purpose code schema validation', () => {
  it('rejects a 5-char purpose code', () => {
    const r = CreditTransferDocumentSchema.safeParse(baseCt({ purpose: 'SALARY' }))
    expect(r.success).toBe(false)
  })

  it('rejects a 5-char category purpose code', () => {
    const r = CreditTransferDocumentSchema.safeParse(baseCt({ categoryPurpose: 'TAXES' }))
    expect(r.success).toBe(false)
  })

  it('accepts a 4-char code', () => {
    expect(CreditTransferDocumentSchema.safeParse(baseCt({ purpose: 'SALA' })).success).toBe(true)
  })
})

describe('Purpose codes in pain.001.001.09', () => {
  it('purpose and categoryPurpose round-trip and are XSD-valid', async () => {
    const xml = writeCreditTransfer(baseCt({ purpose: 'SUPP', categoryPurpose: 'SALA' }))
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
    const r = parse(xml)
    if (!r.ok) throw new Error('parse failed')
    expect(r.data.batches[0]!.transfers[0]!.purpose).toBe('SUPP')
    expect(r.data.batches[0]!.categoryPurpose).toBe('SALA')
  })

  it('absent purpose codes emit no Purp or CtgyPurp elements', () => {
    const xml = writeCreditTransfer(baseCt())
    expect(xml).not.toContain('<Purp>')
    expect(xml).not.toContain('<CtgyPurp>')
  })
})

describe('Purpose codes in pain.008.001.08', () => {
  it('purpose and categoryPurpose round-trip and are XSD-valid', async () => {
    const xml = writeDirectDebit(baseDd({ purpose: 'GDDS', categoryPurpose: 'SUPP' }))
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
    const r = parse(xml)
    if (!r.ok) throw new Error('parse failed')
    const dd = r.data as DirectDebitDocument
    expect(dd.batches[0]!.collections[0]!.purpose).toBe('GDDS')
    expect(dd.batches[0]!.categoryPurpose).toBe('SUPP')
  })
})

describe('Purpose codes fail-loud on unsupported variants', () => {
  it('throws for pain.001.001.03 when a purpose is present', () => {
    expect(() =>
      writeCreditTransfer(baseCt({ purpose: 'SUPP' }), { variant: 'pain.001.001.03' })
    ).toThrow(/purpose codes? .*not supported/)
  })

  it('throws for pain.001.003.03 when a categoryPurpose is present', () => {
    expect(() =>
      writeCreditTransfer(baseCt({ categoryPurpose: 'SALA' }), { variant: 'pain.001.003.03' })
    ).toThrow(/purpose codes? .*not supported/)
  })

  it('throws for pain.008.003.02 when a purpose is present', () => {
    expect(() =>
      writeDirectDebit(baseDd({ purpose: 'GDDS' }), { variant: 'pain.008.003.02' })
    ).toThrow(/purpose codes? .*not supported/)
  })
})
