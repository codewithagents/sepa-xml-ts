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

  it('throws for pain.001.001.03 when only RfrdDocInf is set (no creditorReference)', () => {
    const srDocs = {
      structuredRemittance: { referredDocuments: [{ number: 'INV-001' }] },
    }
    expect(() => writeCreditTransfer(baseCt(srDocs), { variant: 'pain.001.001.03' })).toThrow(
      /structured remittance is not yet supported/
    )
  })

  it('throws for pain.008.003.02 when only RfrdDocAmt is set', () => {
    const srAmt = {
      structuredRemittance: {
        referredDocumentAmount: { remittedAmount: euros('5.00') },
      },
    }
    expect(() => writeDirectDebit(baseDd(srAmt), { variant: 'pain.008.003.02' })).toThrow(
      /structured remittance is not yet supported/
    )
  })
})

// ---------------------------------------------------------------------------
// Shared builder helpers for the new-feature unit tests below.
// ---------------------------------------------------------------------------

/**
 * Write + parse a credit-transfer document with the given structuredRemittance,
 * and return the structured remittance read back from the parsed model.
 */
function ctRoundTrip(
  sr: Record<string, unknown>
): ReturnType<typeof parse>['data'] extends infer T ? T : never {
  const xml = writeCreditTransfer(baseCt({ structuredRemittance: sr }))
  const result = parse(xml)
  if (!result.ok) throw new Error(`parse failed: ${result.error}`)
  return result.data
}

/**
 * Write + parse a direct-debit document with the given structuredRemittance,
 * and return the structured remittance read back from the parsed model.
 */
function ddRoundTrip(
  sr: Record<string, unknown>
): ReturnType<typeof parse>['data'] extends infer T ? T : never {
  const xml = writeDirectDebit(baseDd({ structuredRemittance: sr }))
  const result = parse(xml)
  if (!result.ok) throw new Error(`parse failed: ${result.error}`)
  return result.data
}

/** Extract the structuredRemittance from a pain.001 round-trip result. */
function ctSr(
  sr: Record<string, unknown>
): CreditTransferDocument['batches'][number]['transfers'][number]['structuredRemittance'] {
  const data = ctRoundTrip(sr) as CreditTransferDocument
  return data.batches[0]!.transfers[0]!.structuredRemittance
}

/** Extract the structuredRemittance from a pain.008 round-trip result. */
function ddSr(
  sr: Record<string, unknown>
): DirectDebitDocument['batches'][number]['collections'][number]['structuredRemittance'] {
  const data = ddRoundTrip(sr) as DirectDebitDocument
  return data.batches[0]!.collections[0]!.structuredRemittance
}

// ---------------------------------------------------------------------------
// Unit tests: Prtry reference type (CreditorReferenceType1Choice/Prtry)
// ---------------------------------------------------------------------------

describe('Prtry reference type on CdtrRefInf', () => {
  const prtryRef = {
    creditorReference: 'NAT-REF-42',
    referenceType: { proprietary: 'CUSTOMRT' },
  }

  it('pain.001: emits <Prtry> in CdOrPrtry, not <Cd>', () => {
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: prtryRef }))
    expect(xml).toContain('<Prtry>CUSTOMRT</Prtry>')
    expect(xml).not.toContain('<Cd>CUSTOMRT</Cd>')
  })

  it('pain.001: Prtry reference type round-trips correctly', () => {
    const result = ctSr(prtryRef)
    expect(result).toEqual(prtryRef)
  })

  it('pain.008: emits <Prtry> in CdOrPrtry, not <Cd>', () => {
    const xml = writeDirectDebit(baseDd({ structuredRemittance: prtryRef }))
    expect(xml).toContain('<Prtry>CUSTOMRT</Prtry>')
    expect(xml).not.toContain('<Cd>CUSTOMRT</Cd>')
  })

  it('pain.008: Prtry reference type round-trips correctly', () => {
    const result = ddSr(prtryRef)
    expect(result).toEqual(prtryRef)
  })

  it('Cd path still emits <Cd> (not <Prtry>) for DocumentType3Code enum values', () => {
    const xml = writeCreditTransfer(
      baseCt({ structuredRemittance: { creditorReference: VALID_RF, referenceType: 'RADM' } })
    )
    expect(xml).toContain('<Cd>RADM</Cd>')
    expect(xml).not.toContain('<Prtry>')
  })

  it('is XSD-valid for pain.001 with Prtry referenceType', async () => {
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: prtryRef }))
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
  })

  it('is XSD-valid for pain.008 with Prtry referenceType', async () => {
    const xml = writeDirectDebit(baseDd({ structuredRemittance: prtryRef }))
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Unit tests: RfrdDocInf (referred documents)
// ---------------------------------------------------------------------------

describe('RfrdDocInf (referred documents)', () => {
  const singleDoc = {
    referredDocuments: [{ type: 'CINV', number: 'INV-2025-001', relatedDate: '2025-11-30' }],
    creditorReference: VALID_RF,
    referenceType: 'SCOR',
  }

  it('pain.001: emits <RfrdDocInf> element with Cd type, Nb, and RltdDt', () => {
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: singleDoc }))
    expect(xml).toContain('<RfrdDocInf>')
    expect(xml).toContain('<Cd>CINV</Cd>')
    expect(xml).toContain('<Nb>INV-2025-001</Nb>')
    expect(xml).toContain('<RltdDt>2025-11-30</RltdDt>')
  })

  it('pain.001: RfrdDocInf appears before CdtrRefInf in the XML', () => {
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: singleDoc }))
    const rfrdPos = xml.indexOf('<RfrdDocInf>')
    const cdtrPos = xml.indexOf('<CdtrRefInf>')
    expect(rfrdPos).toBeGreaterThan(0)
    expect(cdtrPos).toBeGreaterThan(0)
    expect(rfrdPos).toBeLessThan(cdtrPos)
  })

  it('pain.001: single RfrdDocInf round-trips correctly', () => {
    const result = ctSr(singleDoc)
    expect(result).toEqual(singleDoc)
  })

  it('pain.008: single RfrdDocInf round-trips correctly', () => {
    const result = ddSr(singleDoc)
    expect(result).toEqual(singleDoc)
  })

  it('pain.001: multiple RfrdDocInf round-trip in order', () => {
    const multiDocs = {
      referredDocuments: [
        { type: 'CINV', number: 'INV-001', relatedDate: '2025-10-01' },
        { type: 'CREN', number: 'CR-001' },
        { number: 'ORD-999', relatedDate: '2025-09-15' },
      ],
      creditorReference: VALID_RF,
      referenceType: 'SCOR',
    }
    const result = ctSr(multiDocs)
    expect(result).toEqual(multiDocs)
  })

  it('pain.008: multiple RfrdDocInf round-trip in order', () => {
    const multiDocs = {
      referredDocuments: [
        { type: 'CINV', number: 'INV-001' },
        { type: 'DEBN', number: 'DBT-002', relatedDate: '2025-12-01' },
      ],
      creditorReference: VALID_RF,
      referenceType: 'SCOR',
    }
    const result = ddSr(multiDocs)
    expect(result).toEqual(multiDocs)
  })

  it('pain.001: multiple RfrdDocInf emit multiple <RfrdDocInf> tags', () => {
    const multiDocs = {
      referredDocuments: [{ number: 'INV-A' }, { number: 'INV-B' }, { number: 'INV-C' }],
      creditorReference: VALID_RF,
      referenceType: 'SCOR',
    }
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: multiDocs }))
    const count = (xml.match(/<RfrdDocInf>/g) ?? []).length
    expect(count).toBe(3)
  })

  it('pain.001: RfrdDocInf with Prtry type emits <Prtry> inside Tp', () => {
    const prtryType = {
      referredDocuments: [{ type: { proprietary: 'CUSTOM-DOC' }, number: 'XYZ-1' }],
      creditorReference: VALID_RF,
      referenceType: 'SCOR',
    }
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: prtryType }))
    expect(xml).toContain('<Prtry>CUSTOM-DOC</Prtry>')
    const result = ctSr(prtryType)
    expect(result).toEqual(prtryType)
  })

  it('pain.001: RfrdDocInf-only (no creditorReference) round-trips correctly', () => {
    const docsOnly = {
      referredDocuments: [{ number: 'INV-ONLY' }],
    }
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: docsOnly }))
    expect(xml).toContain('<RfrdDocInf>')
    expect(xml).not.toContain('<CdtrRefInf>')
    const result = ctSr(docsOnly)
    expect(result).toEqual(docsOnly)
  })

  it('is XSD-valid for pain.001 with single RfrdDocInf', async () => {
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: singleDoc }))
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
  })

  it('is XSD-valid for pain.008 with single RfrdDocInf', async () => {
    const xml = writeDirectDebit(baseDd({ structuredRemittance: singleDoc }))
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Unit tests: RfrdDocAmt (referred-document amounts)
// ---------------------------------------------------------------------------

describe('RfrdDocAmt (referred-document amounts)', () => {
  const withBothAmounts = {
    referredDocumentAmount: {
      duePayableAmount: euros('100.00'),
      remittedAmount: euros('97.50'),
    },
    creditorReference: VALID_RF,
    referenceType: 'SCOR',
  }

  it('pain.001: emits <RfrdDocAmt> with DuePyblAmt and RmtdAmt with Ccy="EUR"', () => {
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: withBothAmounts }))
    expect(xml).toContain('<RfrdDocAmt>')
    expect(xml).toContain('<DuePyblAmt Ccy="EUR">100.00</DuePyblAmt>')
    expect(xml).toContain('<RmtdAmt Ccy="EUR">97.50</RmtdAmt>')
  })

  it('pain.001: RfrdDocAmt appears before CdtrRefInf in the XML', () => {
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: withBothAmounts }))
    const amtPos = xml.indexOf('<RfrdDocAmt>')
    const cdtrPos = xml.indexOf('<CdtrRefInf>')
    expect(amtPos).toBeGreaterThan(0)
    expect(cdtrPos).toBeGreaterThan(0)
    expect(amtPos).toBeLessThan(cdtrPos)
  })

  it('pain.001: round-trips DuePyblAmt and RmtdAmt correctly', () => {
    const result = ctSr(withBothAmounts)
    expect(result).toEqual(withBothAmounts)
  })

  it('pain.008: round-trips DuePyblAmt and RmtdAmt correctly', () => {
    const result = ddSr(withBothAmounts)
    expect(result).toEqual(withBothAmounts)
  })

  it('pain.001: CdtNoteAmt round-trips correctly', () => {
    const withCreditNote = {
      referredDocumentAmount: {
        creditNoteAmount: euros('5.00'),
      },
      creditorReference: VALID_RF,
      referenceType: 'SCOR',
    }
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: withCreditNote }))
    expect(xml).toContain('<CdtNoteAmt Ccy="EUR">5.00</CdtNoteAmt>')
    const result = ctSr(withCreditNote)
    expect(result).toEqual(withCreditNote)
  })

  it('pain.001: RfrdDocAmt-only (no creditorReference) round-trips correctly', () => {
    const amtOnly = {
      referredDocumentAmount: { remittedAmount: euros('50.00') },
    }
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: amtOnly }))
    expect(xml).toContain('<RfrdDocAmt>')
    expect(xml).not.toContain('<CdtrRefInf>')
    const result = ctSr(amtOnly)
    expect(result).toEqual(amtOnly)
  })

  it('pain.001: amounts use exactly 2 decimal places (boundary: 0.01 EUR)', () => {
    const minAmt = { referredDocumentAmount: { remittedAmount: euros('0.01') } }
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: minAmt }))
    expect(xml).toContain('<RmtdAmt Ccy="EUR">0.01</RmtdAmt>')
  })

  it('is XSD-valid for pain.001 with RfrdDocAmt', async () => {
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: withBothAmounts }))
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
  })

  it('is XSD-valid for pain.008 with RfrdDocAmt', async () => {
    const xml = writeDirectDebit(baseDd({ structuredRemittance: withBothAmounts }))
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Unit tests: combined RfrdDocInf + RfrdDocAmt + CdtrRefInf
// ---------------------------------------------------------------------------

describe('Combined RfrdDocInf + RfrdDocAmt + CdtrRefInf', () => {
  const full = {
    referredDocuments: [{ type: 'CINV', number: 'INV-001', relatedDate: '2025-12-01' }],
    referredDocumentAmount: { remittedAmount: euros('200.00') },
    creditorReference: VALID_RF,
    referenceType: 'SCOR',
  }

  it('pain.001: emits all three sections in XSD element order', () => {
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: full }))
    const rfrdPos = xml.indexOf('<RfrdDocInf>')
    const amtPos = xml.indexOf('<RfrdDocAmt>')
    const cdtrPos = xml.indexOf('<CdtrRefInf>')
    expect(rfrdPos).toBeGreaterThan(0)
    expect(amtPos).toBeGreaterThan(0)
    expect(cdtrPos).toBeGreaterThan(0)
    // XSD order: RfrdDocInf < RfrdDocAmt < CdtrRefInf
    expect(rfrdPos).toBeLessThan(amtPos)
    expect(amtPos).toBeLessThan(cdtrPos)
  })

  it('pain.001: full structured remittance round-trips correctly', () => {
    const result = ctSr(full)
    expect(result).toEqual(full)
  })

  it('pain.008: full structured remittance round-trips correctly', () => {
    const result = ddSr(full)
    expect(result).toEqual(full)
  })

  it('is XSD-valid for pain.001 with all three sections', async () => {
    const xml = writeCreditTransfer(baseCt({ structuredRemittance: full }))
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
  })

  it('is XSD-valid for pain.008 with all three sections', async () => {
    const xml = writeDirectDebit(baseDd({ structuredRemittance: full }))
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Unit tests: StructuredRemittanceSchema model-level validation for new fields
// ---------------------------------------------------------------------------

describe('StructuredRemittanceSchema validation for new fields', () => {
  it('rejects an empty object (no creditorReference, no docs, no amounts)', () => {
    expect(StructuredRemittanceSchema.safeParse({}).success).toBe(false)
  })

  it('accepts when only referredDocuments is set', () => {
    expect(
      StructuredRemittanceSchema.safeParse({ referredDocuments: [{ number: 'INV-1' }] }).success
    ).toBe(true)
  })

  it('accepts when only referredDocumentAmount is set', () => {
    expect(
      StructuredRemittanceSchema.safeParse({
        referredDocumentAmount: { remittedAmount: euros('10.00') },
      }).success
    ).toBe(true)
  })

  it('rejects referenceType without creditorReference', () => {
    expect(
      StructuredRemittanceSchema.safeParse({
        referredDocuments: [{ number: 'INV-1' }],
        referenceType: 'SCOR',
      }).success
    ).toBe(false)
  })

  it('rejects issuer without creditorReference', () => {
    expect(
      StructuredRemittanceSchema.safeParse({
        referredDocuments: [{ number: 'INV-1' }],
        issuer: 'ISO',
      }).success
    ).toBe(false)
  })

  it('accepts Prtry referenceType as valid model', () => {
    expect(
      StructuredRemittanceSchema.safeParse({
        creditorReference: 'REF-1',
        referenceType: { proprietary: 'MY-TYPE' },
      }).success
    ).toBe(true)
  })

  it('rejects an empty referredDocuments array', () => {
    expect(
      StructuredRemittanceSchema.safeParse({
        creditorReference: VALID_RF,
        referredDocuments: [],
      }).success
    ).toBe(false)
  })

  it('rejects an empty RemittanceAmount object (all amounts absent)', () => {
    expect(
      StructuredRemittanceSchema.safeParse({
        creditorReference: VALID_RF,
        referredDocumentAmount: {},
      }).success
    ).toBe(false)
  })
})
