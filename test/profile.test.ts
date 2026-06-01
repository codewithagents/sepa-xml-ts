/**
 * Tests for the bank profile seam.
 *
 * Covers:
 * - requireBic profile with credit transfer: missing BIC fails validation and write
 * - requireBic profile with credit transfer: all BICs present -> ok, XSD-valid, round-trips
 * - requireBic profile with direct debit: missing BIC fails validation and write
 * - requireBic profile with direct debit: all BICs present -> ok, XSD-valid, round-trips
 * - batchBooking output option: emits BtchBookg, stays XSD-valid, round-trips
 * - Default (no profile) behaviour is unchanged (golden snapshots not broken here;
 *   this is verified by the golden.test.ts suite running alongside)
 */

import { describe, it, expect } from 'vitest'
import { writeCreditTransfer } from '../src/writer/writer.js'
import { writeDirectDebit } from '../src/writer/direct-debit.js'
import { validateCreditTransfer, validateDirectDebit } from '../src/model/validate.js'
import { parse } from '../src/parser/parser.js'
import { validateXsd } from '../src/xsd.js'
import { euros } from '../src/model/schema.js'
import { requireBic } from '../src/profile/profiles.js'
import type { BankProfile } from '../src/profile/profile.js'
import type { CreditTransferDocument } from '../src/model/schema.js'
import type { DirectDebitDocument } from '../src/model/pain008.js'

// ---------------------------------------------------------------------------
// Fixtures: credit transfer
// ---------------------------------------------------------------------------

/** Credit transfer where the debtor has a BIC but all creditors are IBAN-only. */
const ctNoBicOnCreditor: CreditTransferDocument = {
  messageId: 'CT-NOBIC-001',
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
          amount: euros('12.34'),
          creditor: {
            name: 'Supplier One',
            iban: 'DE65200400300234567000',
            // bic intentionally omitted
          },
        },
      ],
    },
  ],
}

/** Credit transfer where every agent has a BIC. */
const ctAllBics: CreditTransferDocument = {
  messageId: 'CT-ALLBIC-001',
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
          amount: euros('12.34'),
          creditor: {
            name: 'Supplier One',
            iban: 'DE65200400300234567000',
            bic: 'DEUTDEDBFRA',
          },
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Fixtures: direct debit
// ---------------------------------------------------------------------------

/** Direct debit where the creditor has a BIC but a debtor does not. */
const ddNoBicOnDebtor: DirectDebitDocument = {
  messageId: 'DD-NOBIC-001',
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
          amount: euros('9.99'),
          debtor: {
            name: 'Customer One',
            iban: 'DE65200400300234567000',
            // bic intentionally omitted
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

/** Direct debit where every agent has a BIC. */
const ddAllBics: DirectDebitDocument = {
  messageId: 'DD-ALLBIC-001',
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
          amount: euros('9.99'),
          debtor: {
            name: 'Customer One',
            iban: 'DE65200400300234567000',
            bic: 'DEUTDEDBFRA',
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
// requireBic: credit transfer
// ---------------------------------------------------------------------------

describe('requireBic profile: credit transfer', () => {
  it('validateCreditTransfer returns ok:false when a creditor BIC is missing', () => {
    const result = validateCreditTransfer(ctNoBicOnCreditor, { profile: requireBic })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    // Profile issues are returned (base Zod errors are empty because the model is XSD-valid)
    expect(result.profileIssues).toBeDefined()
    expect(result.profileIssues!.length).toBeGreaterThan(0)
    const paths = result.profileIssues!.map((i) => i.path)
    expect(paths).toContain('batches.0.transfers.0.creditor.bic')
  })

  it('writeCreditTransfer throws when a creditor BIC is missing', () => {
    expect(() => writeCreditTransfer(ctNoBicOnCreditor, { profile: requireBic })).toThrow(
      /require-bic/
    )
  })

  it('validateCreditTransfer returns ok:true when all BICs are present', () => {
    const result = validateCreditTransfer(ctAllBics, { profile: requireBic })
    expect(result.ok).toBe(true)
  })

  it('writeCreditTransfer succeeds when all BICs are present and output is XSD-valid', async () => {
    const xml = writeCreditTransfer(ctAllBics, { profile: requireBic })
    const xsdResult = await validateXsd(xml)
    expect(xsdResult.valid, `XSD errors: ${xsdResult.errors.join(', ')}`).toBe(true)
  })

  it('writeCreditTransfer with requireBic round-trips through parse', () => {
    const xml = writeCreditTransfer(ctAllBics, { profile: requireBic })
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    expect(parsed.type).toBe('pain.001')
    if (parsed.type !== 'pain.001') throw new Error('unexpected type')
    expect(parsed.data).toEqual(ctAllBics)
  })

  it('validateCreditTransfer without profile ignores BIC absence (base behaviour)', () => {
    const result = validateCreditTransfer(ctNoBicOnCreditor)
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// requireBic: also reports missing debtor BIC
// ---------------------------------------------------------------------------

describe('requireBic profile: credit transfer debtor BIC', () => {
  const ctNoBicOnDebtor: CreditTransferDocument = {
    messageId: 'CT-NODEBICBIC-001',
    createdAt: '2024-06-01T09:00:00Z',
    initiatingParty: 'Acme GmbH',
    batches: [
      {
        id: 'BATCH-001',
        executionDate: '2024-06-10',
        debtor: {
          name: 'Acme GmbH',
          iban: 'DE89370400440532013000',
          // bic intentionally omitted on debtor
        },
        transfers: [
          {
            endToEndId: 'E2E-0001',
            amount: euros('1.00'),
            creditor: { name: 'Vendor', iban: 'DE65200400300234567000', bic: 'DEUTDEDBFRA' },
          },
        ],
      },
    ],
  }

  it('reports missing debtor BIC at correct path', () => {
    const result = validateCreditTransfer(ctNoBicOnDebtor, { profile: requireBic })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    const paths = result.profileIssues?.map((i) => i.path) ?? []
    expect(paths).toContain('batches.0.debtor.bic')
  })
})

// ---------------------------------------------------------------------------
// requireBic: direct debit
// ---------------------------------------------------------------------------

describe('requireBic profile: direct debit', () => {
  it('validateDirectDebit returns ok:false when a debtor BIC is missing', () => {
    const result = validateDirectDebit(ddNoBicOnDebtor, { profile: requireBic })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.profileIssues).toBeDefined()
    expect(result.profileIssues!.length).toBeGreaterThan(0)
    const paths = result.profileIssues!.map((i) => i.path)
    expect(paths).toContain('batches.0.collections.0.debtor.bic')
  })

  it('writeDirectDebit throws when a debtor BIC is missing', () => {
    expect(() => writeDirectDebit(ddNoBicOnDebtor, { profile: requireBic })).toThrow(/require-bic/)
  })

  it('validateDirectDebit returns ok:true when all BICs are present', () => {
    const result = validateDirectDebit(ddAllBics, { profile: requireBic })
    expect(result.ok).toBe(true)
  })

  it('writeDirectDebit succeeds when all BICs are present and output is XSD-valid', async () => {
    const xml = writeDirectDebit(ddAllBics, { profile: requireBic })
    const xsdResult = await validateXsd(xml)
    expect(xsdResult.valid, `XSD errors: ${xsdResult.errors.join(', ')}`).toBe(true)
  })

  it('writeDirectDebit with requireBic round-trips through parse', () => {
    const xml = writeDirectDebit(ddAllBics, { profile: requireBic })
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    expect(parsed.type).toBe('pain.008')
    if (parsed.type !== 'pain.008') throw new Error('unexpected type')
    expect(parsed.data).toEqual(ddAllBics)
  })

  it('validateDirectDebit without profile ignores BIC absence (base behaviour)', () => {
    const result = validateDirectDebit(ddNoBicOnDebtor)
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// requireBic: direct debit creditor BIC
// ---------------------------------------------------------------------------

describe('requireBic profile: direct debit creditor BIC', () => {
  const ddNoBicOnCreditor: DirectDebitDocument = {
    messageId: 'DD-NOCREDBIC-001',
    createdAt: '2024-06-01T09:00:00Z',
    initiatingParty: 'My Company GmbH',
    creditor: {
      name: 'My Company GmbH',
      iban: 'DE89370400440532013000',
      // bic intentionally omitted on creditor
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
            amount: euros('5.00'),
            debtor: { name: 'Customer', iban: 'DE65200400300234567000', bic: 'DEUTDEDBFRA' },
            mandate: { id: 'MAND-0001', signatureDate: '2024-01-15' },
          },
        ],
      },
    ],
  }

  it('reports missing creditor BIC at correct path', () => {
    const result = validateDirectDebit(ddNoBicOnCreditor, { profile: requireBic })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    const paths = result.profileIssues?.map((i) => i.path) ?? []
    expect(paths).toContain('creditor.bic')
  })
})

// ---------------------------------------------------------------------------
// output.batchBooking: credit transfer
// ---------------------------------------------------------------------------

describe('output.batchBooking: credit transfer', () => {
  const bbProfile: BankProfile = { id: 'bb', output: { batchBooking: true } }

  it('emits BtchBookg true in each PmtInf when batchBooking is true', () => {
    const xml = writeCreditTransfer(ctAllBics, { profile: bbProfile })
    expect(xml).toContain('<BtchBookg>true</BtchBookg>')
  })

  it('BtchBookg appears after PmtMtd and before NbOfTxs', () => {
    const xml = writeCreditTransfer(ctAllBics, { profile: bbProfile })
    const pmtMtdPos = xml.indexOf('<PmtMtd>')
    const btchBookgPos = xml.indexOf('<BtchBookg>')
    const nbOfTxsPos = xml.indexOf('<NbOfTxs>', pmtMtdPos)
    expect(pmtMtdPos).toBeGreaterThanOrEqual(0)
    expect(btchBookgPos).toBeGreaterThan(pmtMtdPos)
    expect(btchBookgPos).toBeLessThan(nbOfTxsPos)
  })

  it('output with batchBooking is XSD-valid', async () => {
    const xml = writeCreditTransfer(ctAllBics, { profile: bbProfile })
    const xsdResult = await validateXsd(xml)
    expect(xsdResult.valid, `XSD errors: ${xsdResult.errors.join(', ')}`).toBe(true)
  })

  it('parse round-trips the model (BtchBookg is not a model field, parser ignores it)', () => {
    const xml = writeCreditTransfer(ctAllBics, { profile: bbProfile })
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    expect(parsed.type).toBe('pain.001')
    if (parsed.type !== 'pain.001') throw new Error('unexpected type')
    expect(parsed.data).toEqual(ctAllBics)
  })

  it('emits BtchBookg false when batchBooking is false', () => {
    const bbFalseProfile: BankProfile = { id: 'bb-false', output: { batchBooking: false } }
    const xml = writeCreditTransfer(ctAllBics, { profile: bbFalseProfile })
    expect(xml).toContain('<BtchBookg>false</BtchBookg>')
  })

  it('no BtchBookg emitted when no profile given (default behaviour)', () => {
    const xml = writeCreditTransfer(ctAllBics)
    expect(xml).not.toContain('<BtchBookg>')
  })
})

// ---------------------------------------------------------------------------
// output.batchBooking: direct debit
// ---------------------------------------------------------------------------

describe('output.batchBooking: direct debit', () => {
  const bbProfile: BankProfile = { id: 'bb', output: { batchBooking: true } }

  it('emits BtchBookg true in each PmtInf when batchBooking is true', () => {
    const xml = writeDirectDebit(ddAllBics, { profile: bbProfile })
    expect(xml).toContain('<BtchBookg>true</BtchBookg>')
  })

  it('output with batchBooking is XSD-valid', async () => {
    const xml = writeDirectDebit(ddAllBics, { profile: bbProfile })
    const xsdResult = await validateXsd(xml)
    expect(xsdResult.valid, `XSD errors: ${xsdResult.errors.join(', ')}`).toBe(true)
  })

  it('parse round-trips the model (BtchBookg is not a model field, parser ignores it)', () => {
    const xml = writeDirectDebit(ddAllBics, { profile: bbProfile })
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    expect(parsed.type).toBe('pain.008')
    if (parsed.type !== 'pain.008') throw new Error('unexpected type')
    expect(parsed.data).toEqual(ddAllBics)
  })

  it('no BtchBookg emitted when no profile given (default behaviour)', () => {
    const xml = writeDirectDebit(ddAllBics)
    expect(xml).not.toContain('<BtchBookg>')
  })
})
