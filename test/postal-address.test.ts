/**
 * Unit tests for structured postal address (PstlAdr) support.
 *
 * Scope: pain.001.001.09 and pain.008.001.08 only. Legacy and DK variants must
 * throw if an address is present (fail loud, never silently drop address data).
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

describe('PstlAdr fail-loud on unsupported variants', () => {
  it('throws for pain.001.001.03 when an address is present', () => {
    expect(() => writeCreditTransfer(baseCt(FULL_ADDRESS), { variant: 'pain.001.001.03' })).toThrow(
      /postal address is not yet supported/
    )
  })

  it('throws for pain.001.003.03 when an address is present', () => {
    expect(() => writeCreditTransfer(baseCt(FULL_ADDRESS), { variant: 'pain.001.003.03' })).toThrow(
      /postal address is not yet supported/
    )
  })

  it('throws for pain.008.003.02 when an address is present', () => {
    expect(() => writeDirectDebit(baseDd(FULL_ADDRESS), { variant: 'pain.008.003.02' })).toThrow(
      /postal address is not yet supported/
    )
  })

  it('does NOT throw for legacy variant when no address is present', () => {
    expect(() => writeCreditTransfer(baseCt(), { variant: 'pain.001.001.03' })).not.toThrow()
  })
})
