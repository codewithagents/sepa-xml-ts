/**
 * Unit tests for purpose (Purp) and category purpose (CtgyPurp).
 *
 * Scope: pain.001.001.09 and pain.008.001.08 only. Legacy and DK variants must
 * throw if a purpose or categoryPurpose is present (fail loud, never drop silently).
 *
 * Two paths per field:
 *   Cd    - a plain string (ExternalPurpose1Code / ExternalCategoryPurpose1Code, 1-4 chars).
 *   Prtry - an object { proprietary: string } (Max35Text, 1-35 chars SEPA charset).
 *
 * Validation policy (Cd): SEPA charset + length 1 to 4 only. We do NOT validate
 * against the ISO external code list, which is updated quarterly.
 * Validation policy (Prtry): SEPA charset + length 1 to 35 (Max35Text).
 */

import { describe, it, expect } from 'vitest'
import { writeCreditTransfer } from '../src/writer/writer.js'
import { writeDirectDebit } from '../src/writer/direct-debit.js'
import { parse } from '../src/parser/parser.js'
import { validateXsd } from '../src/xsd.js'
import { CreditTransferDocumentSchema, euros } from '../src/model/schema.js'
import type { CreditTransferDocument, Purpose, CategoryPurpose } from '../src/model/schema.js'
import type { DirectDebitDocument } from '../src/model/pain008.js'

// ---------------------------------------------------------------------------
// Shared builders: accept the full Purpose / CategoryPurpose union
// ---------------------------------------------------------------------------

function baseCt(opts?: {
  purpose?: Purpose
  categoryPurpose?: CategoryPurpose
}): CreditTransferDocument {
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
  }
}

function baseDd(opts?: {
  purpose?: Purpose
  categoryPurpose?: CategoryPurpose
}): DirectDebitDocument {
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
  }
}

// ---------------------------------------------------------------------------
// Shared helper: assert XSD validity and parse, return the document data.
// Reduces copy-paste of the validateXsd + parse + error-check boilerplate.
// ---------------------------------------------------------------------------

async function assertXsdValidAndParse(xml: string) {
  const xsd = await validateXsd(xml)
  expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
  const r = parse(xml)
  if (!r.ok) throw new Error(`parse failed: ${r.error}`)
  return r.data
}

// ---------------------------------------------------------------------------
// Cd schema validation (plain string path)
// ---------------------------------------------------------------------------

describe('Purpose code schema validation (Cd path)', () => {
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

// ---------------------------------------------------------------------------
// Prtry schema validation
// ---------------------------------------------------------------------------

describe('Proprietary purpose schema validation (Prtry path)', () => {
  it('accepts a proprietary purpose with 1-35 SEPA chars', () => {
    const r = CreditTransferDocumentSchema.safeParse(
      baseCt({ purpose: { proprietary: 'CUSTOM-BANK-PURPOSE' } })
    )
    expect(r.success).toBe(true)
  })

  it('accepts a proprietary categoryPurpose', () => {
    const r = CreditTransferDocumentSchema.safeParse(
      baseCt({ categoryPurpose: { proprietary: 'INTERNAL-BATCH' } })
    )
    expect(r.success).toBe(true)
  })

  it('rejects a proprietary purpose that exceeds 35 chars', () => {
    const r = CreditTransferDocumentSchema.safeParse(
      baseCt({ purpose: { proprietary: 'A'.repeat(36) } })
    )
    expect(r.success).toBe(false)
  })

  it('rejects a proprietary purpose with non-SEPA chars', () => {
    const r = CreditTransferDocumentSchema.safeParse(baseCt({ purpose: { proprietary: 'BAD€' } }))
    expect(r.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Cd path: pain.001.001.09
// ---------------------------------------------------------------------------

describe('Cd purpose in pain.001.001.09', () => {
  it('purpose and categoryPurpose round-trip and are XSD-valid', async () => {
    const xml = writeCreditTransfer(baseCt({ purpose: 'SUPP', categoryPurpose: 'SALA' }))
    const data = await assertXsdValidAndParse(xml)
    expect(data.batches[0]!.transfers[0]!.purpose).toBe('SUPP')
    expect(data.batches[0]!.categoryPurpose).toBe('SALA')
  })

  it('emits <Cd> inside <Purp> and <CtgyPurp> for the Cd path', () => {
    const xml = writeCreditTransfer(baseCt({ purpose: 'SUPP', categoryPurpose: 'SALA' }))
    expect(xml).toContain('<Purp>')
    expect(xml).toContain('<Cd>SUPP</Cd>')
    expect(xml).toContain('<CtgyPurp>')
    expect(xml).toContain('<Cd>SALA</Cd>')
    expect(xml).not.toContain('<Prtry>SUPP</Prtry>')
  })

  it('absent purpose codes emit no Purp or CtgyPurp elements', () => {
    const xml = writeCreditTransfer(baseCt())
    expect(xml).not.toContain('<Purp>')
    expect(xml).not.toContain('<CtgyPurp>')
  })
})

// ---------------------------------------------------------------------------
// Prtry path: pain.001.001.09
// ---------------------------------------------------------------------------

describe('Proprietary purpose (Prtry) in pain.001.001.09', () => {
  it('emits <Prtry> inside <Purp> and round-trips correctly', async () => {
    const xml = writeCreditTransfer(baseCt({ purpose: { proprietary: 'MY-BANK-CODE' } }))
    expect(xml).toContain('<Purp>')
    expect(xml).toContain('<Prtry>MY-BANK-CODE</Prtry>')
    expect(xml).not.toContain('<Cd>MY-BANK-CODE</Cd>')
    const data = await assertXsdValidAndParse(xml)
    expect(data.batches[0]!.transfers[0]!.purpose).toEqual({ proprietary: 'MY-BANK-CODE' })
  })

  it('emits <Prtry> inside <CtgyPurp> and round-trips correctly', async () => {
    const xml = writeCreditTransfer(baseCt({ categoryPurpose: { proprietary: 'PAYROLL-RUN-42' } }))
    expect(xml).toContain('<CtgyPurp>')
    expect(xml).toContain('<Prtry>PAYROLL-RUN-42</Prtry>')
    expect(xml).not.toContain('<Cd>PAYROLL-RUN-42</Cd>')
    const data = await assertXsdValidAndParse(xml)
    expect(data.batches[0]!.categoryPurpose).toEqual({ proprietary: 'PAYROLL-RUN-42' })
  })

  it('round-trips Prtry purpose and Prtry categoryPurpose together', async () => {
    const xml = writeCreditTransfer(
      baseCt({ purpose: { proprietary: 'TX-PRTRY' }, categoryPurpose: { proprietary: 'BT-PRTRY' } })
    )
    const data = await assertXsdValidAndParse(xml)
    expect(data.batches[0]!.transfers[0]!.purpose).toEqual({ proprietary: 'TX-PRTRY' })
    expect(data.batches[0]!.categoryPurpose).toEqual({ proprietary: 'BT-PRTRY' })
  })
})

// ---------------------------------------------------------------------------
// Cd path: pain.008.001.08
// ---------------------------------------------------------------------------

describe('Cd purpose in pain.008.001.08', () => {
  it('purpose and categoryPurpose round-trip and are XSD-valid', async () => {
    const xml = writeDirectDebit(baseDd({ purpose: 'GDDS', categoryPurpose: 'SUPP' }))
    const data = (await assertXsdValidAndParse(xml)) as DirectDebitDocument
    expect(data.batches[0]!.collections[0]!.purpose).toBe('GDDS')
    expect(data.batches[0]!.categoryPurpose).toBe('SUPP')
  })
})

// ---------------------------------------------------------------------------
// Prtry path: pain.008.001.08
// ---------------------------------------------------------------------------

describe('Proprietary purpose (Prtry) in pain.008.001.08', () => {
  it('emits <Prtry> inside <Purp> and round-trips correctly', async () => {
    const xml = writeDirectDebit(baseDd({ purpose: { proprietary: 'DD-BANK-CODE' } }))
    expect(xml).toContain('<Purp>')
    expect(xml).toContain('<Prtry>DD-BANK-CODE</Prtry>')
    expect(xml).not.toContain('<Cd>DD-BANK-CODE</Cd>')
    const data = (await assertXsdValidAndParse(xml)) as DirectDebitDocument
    expect(data.batches[0]!.collections[0]!.purpose).toEqual({ proprietary: 'DD-BANK-CODE' })
  })

  it('emits <Prtry> inside <CtgyPurp> and round-trips correctly', async () => {
    const xml = writeDirectDebit(baseDd({ categoryPurpose: { proprietary: 'DD-CTGY-PRTRY' } }))
    expect(xml).toContain('<CtgyPurp>')
    expect(xml).toContain('<Prtry>DD-CTGY-PRTRY</Prtry>')
    expect(xml).not.toContain('<Cd>DD-CTGY-PRTRY</Cd>')
    const data = (await assertXsdValidAndParse(xml)) as DirectDebitDocument
    expect(data.batches[0]!.categoryPurpose).toEqual({ proprietary: 'DD-CTGY-PRTRY' })
  })

  it('round-trips Prtry purpose and Prtry categoryPurpose together', async () => {
    const xml = writeDirectDebit(
      baseDd({
        purpose: { proprietary: 'DD-TX-PRTRY' },
        categoryPurpose: { proprietary: 'DD-BT-P' },
      })
    )
    const data = (await assertXsdValidAndParse(xml)) as DirectDebitDocument
    expect(data.batches[0]!.collections[0]!.purpose).toEqual({ proprietary: 'DD-TX-PRTRY' })
    expect(data.batches[0]!.categoryPurpose).toEqual({ proprietary: 'DD-BT-P' })
  })
})

// ---------------------------------------------------------------------------
// Legacy/DK variants throw for ANY purpose (Cd or Prtry)
// ---------------------------------------------------------------------------

describe('Purpose fail-loud on unsupported variants (Cd and Prtry)', () => {
  it('throws for pain.001.001.03 with Cd purpose', () => {
    expect(() =>
      writeCreditTransfer(baseCt({ purpose: 'SUPP' }), { variant: 'pain.001.001.03' })
    ).toThrow(/purpose codes? .*not supported/)
  })

  it('throws for pain.001.001.03 with Prtry purpose', () => {
    expect(() =>
      writeCreditTransfer(baseCt({ purpose: { proprietary: 'MY-CODE' } }), {
        variant: 'pain.001.001.03',
      })
    ).toThrow(/purpose codes? .*not supported/)
  })

  it('throws for pain.001.003.03 with Cd categoryPurpose', () => {
    expect(() =>
      writeCreditTransfer(baseCt({ categoryPurpose: 'SALA' }), { variant: 'pain.001.003.03' })
    ).toThrow(/purpose codes? .*not supported/)
  })

  it('throws for pain.001.003.03 with Prtry categoryPurpose', () => {
    expect(() =>
      writeCreditTransfer(baseCt({ categoryPurpose: { proprietary: 'BATCH-X' } }), {
        variant: 'pain.001.003.03',
      })
    ).toThrow(/purpose codes? .*not supported/)
  })

  it('throws for pain.008.003.02 with Cd purpose', () => {
    expect(() =>
      writeDirectDebit(baseDd({ purpose: 'GDDS' }), { variant: 'pain.008.003.02' })
    ).toThrow(/purpose codes? .*not supported/)
  })

  it('throws for pain.008.003.02 with Prtry purpose', () => {
    expect(() =>
      writeDirectDebit(baseDd({ purpose: { proprietary: 'DD-CUSTOM' } }), {
        variant: 'pain.008.003.02',
      })
    ).toThrow(/purpose codes? .*not supported/)
  })
})
