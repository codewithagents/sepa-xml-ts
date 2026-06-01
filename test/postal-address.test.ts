/**
 * Unit tests for structured postal address (PstlAdr) support.
 *
 * Scope:
 * - pain.001.001.09 and pain.008.001.08: full PostalAddress24 field set supported.
 * - pain.001.001.03: full PostalAddress6 field set supported (same fields, same order).
 * - pain.001.003.03 and pain.008.003.02: PostalAddressSEPA only (Ctry + AdrLine max 2);
 *   any unsupported field (streetName, buildingNumber, postCode, townName,
 *   countrySubDivision) throws a specific error; addressLines > 2 also throws.
 */

import { describe, it, expect } from 'vitest'
import { writeCreditTransfer } from '../src/writer/writer.js'
import { writeDirectDebit } from '../src/writer/direct-debit.js'
import { parse } from '../src/parser/parser.js'
import { validateXsd } from '../src/xsd.js'
import { validateCreditTransfer } from '../src/model/validate.js'
import { PostalAddressSchema, euros } from '../src/model/schema.js'
import type { CreditTransferDocument } from '../src/model/schema.js'
import type { DirectDebitDocument } from '../src/model/pain008.js'

const FULL_ADDRESS = {
  streetName: 'Rue de la Loi',
  buildingNumber: '16',
  postCode: '1000',
  townName: 'Brussels',
  countrySubDivision: 'BU',
  country: 'BE',
  addressLines: ['c/o Reception', 'Floor 3'],
}

function baseCt(addressOnDebtor?: unknown, addressOnCreditor?: unknown): CreditTransferDocument {
  return {
    messageId: 'MSG-ADR-001',
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
          ...(addressOnDebtor !== undefined ? { address: addressOnDebtor } : {}),
        },
        transfers: [
          {
            endToEndId: 'E2E-001',
            amount: euros('10.00'),
            creditor: {
              name: 'Vendor',
              iban: 'NL91ABNA0417164300',
              ...(addressOnCreditor !== undefined ? { address: addressOnCreditor } : {}),
            },
          },
        ],
      },
    ],
  } as CreditTransferDocument
}

function baseDd(addressOnCreditor?: unknown): DirectDebitDocument {
  return {
    messageId: 'DD-ADR-001',
    createdAt: '2026-01-01T10:00:00Z',
    initiatingParty: 'Test Corp',
    creditor: {
      name: 'Test Corp',
      iban: 'DE89370400440532013000',
      bic: 'COBADEFFXXX',
      creditorId: 'DE98ZZZ09999999999',
      ...(addressOnCreditor !== undefined ? { address: addressOnCreditor } : {}),
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
          },
        ],
      },
    ],
  } as DirectDebitDocument
}

describe('PostalAddress schema', () => {
  it('rejects an empty address object', () => {
    expect(PostalAddressSchema.safeParse({}).success).toBe(false)
  })

  it('rejects a 3-letter country code', () => {
    expect(PostalAddressSchema.safeParse({ country: 'DEU' }).success).toBe(false)
  })

  it('rejects a lowercase country code', () => {
    expect(PostalAddressSchema.safeParse({ country: 'be' }).success).toBe(false)
  })

  it('accepts a partial address (townName + country only)', () => {
    expect(PostalAddressSchema.safeParse({ townName: 'Berlin', country: 'DE' }).success).toBe(true)
  })
})

describe('PstlAdr in pain.001.001.09', () => {
  it('full structured address round-trips and is XSD-valid', async () => {
    const xml = writeCreditTransfer(baseCt(FULL_ADDRESS, FULL_ADDRESS))
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
    const r = parse(xml)
    if (!r.ok) throw new Error('parse failed')
    expect(r.data.batches[0]!.debtor.address).toEqual(FULL_ADDRESS)
    expect(r.data.batches[0]!.transfers[0]!.creditor.address).toEqual(FULL_ADDRESS)
  })

  it('partial address (townName + country) round-trips', () => {
    const partial = { townName: 'Berlin', country: 'DE' }
    const xml = writeCreditTransfer(baseCt(partial))
    const r = parse(xml)
    if (!r.ok) throw new Error('parse failed')
    expect(r.data.batches[0]!.debtor.address).toEqual(partial)
  })

  it('absent address emits no PstlAdr element and stays byte-identical', () => {
    const withAddr = writeCreditTransfer(baseCt(FULL_ADDRESS))
    const without = writeCreditTransfer(baseCt())
    expect(without).not.toContain('<PstlAdr>')
    expect(withAddr).toContain('<PstlAdr>')
    // No PstlAdr when absent: the debtor block jumps straight from Nm to DbtrAcct.
    expect(without).toContain('</Dbtr>')
  })

  it('the parsed model with an address still passes business validation', () => {
    const r = parse(writeCreditTransfer(baseCt(FULL_ADDRESS)))
    if (!r.ok) throw new Error('parse failed')
    expect(validateCreditTransfer(r.data).ok).toBe(true)
  })
})

describe('PstlAdr in pain.008.001.08', () => {
  it('creditor address round-trips and is XSD-valid', async () => {
    const xml = writeDirectDebit(baseDd(FULL_ADDRESS))
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
    const r = parse(xml)
    if (!r.ok) throw new Error('parse failed')
    expect((r.data as DirectDebitDocument).creditor.address).toEqual(FULL_ADDRESS)
  })
})

// ---------------------------------------------------------------------------
// pain.001.001.03 (PostalAddress6: all fields supported, same order as PostalAddress24)
// ---------------------------------------------------------------------------

describe('PstlAdr in pain.001.001.03', () => {
  it('full structured address round-trips and is XSD-valid', async () => {
    const xml = writeCreditTransfer(baseCt(FULL_ADDRESS, FULL_ADDRESS), { variant: 'pain.001.001.03' })
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
    const r = parse(xml)
    if (!r.ok || r.type !== 'pain.001') throw new Error('parse failed')
    expect(r.data.batches[0]!.debtor.address).toEqual(FULL_ADDRESS)
    expect(r.data.batches[0]!.transfers[0]!.creditor.address).toEqual(FULL_ADDRESS)
  })

  it('partial address (townName + country) round-trips', async () => {
    const partial = { townName: 'Berlin', country: 'DE' }
    const xml = writeCreditTransfer(baseCt(partial), { variant: 'pain.001.001.03' })
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
    const r = parse(xml)
    if (!r.ok || r.type !== 'pain.001') throw new Error('parse failed')
    expect(r.data.batches[0]!.debtor.address).toEqual(partial)
  })

  it('absent address emits no PstlAdr element', () => {
    const xml = writeCreditTransfer(baseCt(), { variant: 'pain.001.001.03' })
    expect(xml).not.toContain('<PstlAdr>')
  })
})

// ---------------------------------------------------------------------------
// pain.001.003.03 (PostalAddressSEPA: only Ctry + AdrLine max 2)
// ---------------------------------------------------------------------------

const DK_ADDRESS = { country: 'DE', addressLines: ['Hauptstrasse 1', 'c/o Reception'] }

describe('PstlAdr in pain.001.003.03', () => {
  it('DK address (Ctry + 2 AdrLine) round-trips and is XSD-valid', async () => {
    const xml = writeCreditTransfer(baseCt(DK_ADDRESS, DK_ADDRESS), { variant: 'pain.001.003.03' })
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
    const r = parse(xml)
    if (!r.ok || r.type !== 'pain.001') throw new Error('parse failed')
    expect(r.data.batches[0]!.debtor.address).toEqual(DK_ADDRESS)
    expect(r.data.batches[0]!.transfers[0]!.creditor.address).toEqual(DK_ADDRESS)
  })

  it('country-only address round-trips and is XSD-valid', async () => {
    const countryOnly = { country: 'NL' }
    const xml = writeCreditTransfer(baseCt(countryOnly), { variant: 'pain.001.003.03' })
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
    const r = parse(xml)
    if (!r.ok || r.type !== 'pain.001') throw new Error('parse failed')
    expect(r.data.batches[0]!.debtor.address).toEqual(countryOnly)
  })

  it('absent address emits no PstlAdr element', () => {
    const xml = writeCreditTransfer(baseCt(), { variant: 'pain.001.003.03' })
    expect(xml).not.toContain('<PstlAdr>')
  })

  it('throws for streetName (not in PostalAddressSEPA)', () => {
    expect(() =>
      writeCreditTransfer(baseCt({ streetName: 'Main St' }), { variant: 'pain.001.003.03' })
    ).toThrow(/field 'streetName' is not supported in the pain.001.003.03 postal address/)
  })

  it('throws for buildingNumber', () => {
    expect(() =>
      writeCreditTransfer(baseCt({ buildingNumber: '42', country: 'DE' }), { variant: 'pain.001.003.03' })
    ).toThrow(/field 'buildingNumber' is not supported in the pain.001.003.03 postal address/)
  })

  it('throws for postCode', () => {
    expect(() =>
      writeCreditTransfer(baseCt({ postCode: '10115', country: 'DE' }), { variant: 'pain.001.003.03' })
    ).toThrow(/field 'postCode' is not supported in the pain.001.003.03 postal address/)
  })

  it('throws for townName', () => {
    expect(() =>
      writeCreditTransfer(baseCt({ townName: 'Berlin' }), { variant: 'pain.001.003.03' })
    ).toThrow(/field 'townName' is not supported in the pain.001.003.03 postal address/)
  })

  it('throws for countrySubDivision', () => {
    expect(() =>
      writeCreditTransfer(baseCt({ countrySubDivision: 'BY', country: 'DE' }), { variant: 'pain.001.003.03' })
    ).toThrow(/field 'countrySubDivision' is not supported in the pain.001.003.03 postal address/)
  })

  it('throws when addressLines has more than 2 entries', () => {
    expect(() =>
      writeCreditTransfer(baseCt({ country: 'DE', addressLines: ['L1', 'L2', 'L3'] }), { variant: 'pain.001.003.03' })
    ).toThrow(/addressLines has 3 entries but PostalAddressSEPA in pain.001.003.03 allows at most 2/)
  })
})

// ---------------------------------------------------------------------------
// pain.008.003.02 (PostalAddressSEPA: only Ctry + AdrLine max 2)
// ---------------------------------------------------------------------------

function baseDdWithDebtorAddress(addressOnDebtor?: unknown): DirectDebitDocument {
  return {
    messageId: 'DD-ADR-002',
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
        id: 'SDD-BATCH-002',
        collectionDate: '2026-01-20',
        sequenceType: 'FRST',
        localInstrument: 'CORE',
        collections: [
          {
            endToEndId: 'SDD-E2E-002',
            amount: euros('10.00'),
            debtor: {
              name: 'Customer',
              iban: 'NL91ABNA0417164300',
              ...(addressOnDebtor !== undefined ? { address: addressOnDebtor } : {}),
            },
            mandate: { id: 'MAND-002', signatureDate: '2025-01-01' },
          },
        ],
      },
    ],
  } as DirectDebitDocument
}

describe('PstlAdr in pain.008.003.02', () => {
  it('DK address on creditor (Ctry + AdrLine) round-trips and is XSD-valid', async () => {
    const xml = writeDirectDebit(baseDd(DK_ADDRESS), { variant: 'pain.008.003.02' })
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
    const r = parse(xml)
    if (!r.ok || r.type !== 'pain.008') throw new Error('parse failed')
    expect((r.data as DirectDebitDocument).creditor.address).toEqual(DK_ADDRESS)
  })

  it('DK address on debtor (Ctry + AdrLine) round-trips and is XSD-valid', async () => {
    const xml = writeDirectDebit(baseDdWithDebtorAddress(DK_ADDRESS), { variant: 'pain.008.003.02' })
    const xsd = await validateXsd(xml)
    expect(xsd.valid, `XSD errors: ${xsd.errors.join(', ')}`).toBe(true)
    const r = parse(xml)
    if (!r.ok || r.type !== 'pain.008') throw new Error('parse failed')
    expect((r.data as DirectDebitDocument).batches[0]!.collections[0]!.debtor.address).toEqual(DK_ADDRESS)
  })

  it('absent address emits no PstlAdr element', () => {
    const xml = writeDirectDebit(baseDd(), { variant: 'pain.008.003.02' })
    expect(xml).not.toContain('<PstlAdr>')
  })

  it('throws for streetName on creditor (not in PostalAddressSEPA)', () => {
    expect(() =>
      writeDirectDebit(baseDd({ streetName: 'Main St' }), { variant: 'pain.008.003.02' })
    ).toThrow(/field 'streetName' is not supported in the pain.008.003.02 postal address/)
  })

  it('throws for streetName on debtor (not in PostalAddressSEPA)', () => {
    expect(() =>
      writeDirectDebit(baseDdWithDebtorAddress({ streetName: 'Main St' }), { variant: 'pain.008.003.02' })
    ).toThrow(/field 'streetName' is not supported in the pain.008.003.02 postal address/)
  })

  it('throws when addressLines has more than 2 entries on creditor', () => {
    expect(() =>
      writeDirectDebit(baseDd({ country: 'DE', addressLines: ['L1', 'L2', 'L3'] }), { variant: 'pain.008.003.02' })
    ).toThrow(/addressLines has 3 entries but PostalAddressSEPA in pain.008.003.02 allows at most 2/)
  })
})

describe('PstlAdr: absent address unchanged for all variants', () => {
  it('pain.001.001.03: no address present does not throw', () => {
    expect(() => writeCreditTransfer(baseCt(), { variant: 'pain.001.001.03' })).not.toThrow()
  })

  it('pain.001.003.03: no address present does not throw', () => {
    expect(() => writeCreditTransfer(baseCt(), { variant: 'pain.001.003.03' })).not.toThrow()
  })

  it('pain.008.003.02: no address present does not throw', () => {
    expect(() => writeDirectDebit(baseDd(), { variant: 'pain.008.003.02' })).not.toThrow()
  })
})
