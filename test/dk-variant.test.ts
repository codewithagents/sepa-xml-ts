/**
 * Tests for the German DK national write+read variant: pain.001.003.03.
 *
 * The pain.001.003.03 namespace is the German DFU agreement national variant.
 * It has a different structure from pain.001.001.09:
 *   - Different namespace: urn:iso:std:iso:20022:tech:xsd:pain.001.003.03
 *   - ReqdExctnDt is a plain ISODate (no <Dt> wrapper)
 *   - FinInstnId uses <BIC> element (not <BICFI>)
 *   - DbtrAgt is required: when debtor.bic is absent, emits NOTPROVIDED
 *   - CdtrAgt (transaction level) is optional: omitted when creditor.bic is absent
 *
 * The DK XSD at schemas/dk/pain.001.003.03.xsd is the correctness oracle.
 * The vendored sepa_king.pain.001.003.03.xml is a real-world reference fixture.
 *
 * Round-trip notes:
 *   - The round-trip is fully clean when debtor.bic is present.
 *   - When debtor.bic is absent, the writer emits NOTPROVIDED in DbtrAgt; the
 *     parser reads back from BIC/BICFI, but fast-xml-parser sees the Othr/Id text
 *     "NOTPROVIDED" via a path that does not match the BIC path, so bic comes back
 *     as undefined. This means debtor.bic=undefined survives the round-trip cleanly.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/parser/parser.js'
import { validateXsd } from '../src/xsd.js'
import { writeCreditTransfer } from '../src/writer/writer.js'
import { euros } from '../src/model/schema.js'
import type { CreditTransferDocument } from '../src/model/schema.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const FIXTURES_DIR = join(__dirname, 'golden/fixtures')

// ---------------------------------------------------------------------------
// Test document: minimal CreditTransferDocument with and without BIC
// ---------------------------------------------------------------------------

const DEBTOR_IBAN = 'DE89370400440532013000'
const CREDITOR_IBAN = 'DE65200400300234567000'
const CREDITOR_IBAN2 = 'NL91ABNA0417164300'

const DK_DOC_WITH_BIC: CreditTransferDocument = {
  messageId: 'DK-TEST-001',
  createdAt: '2025-01-15T09:00:00Z',
  initiatingParty: 'DK Test Corp',
  batches: [
    {
      id: 'DK-BATCH-001',
      executionDate: '2025-01-20',
      debtor: {
        name: 'DK Test Corp',
        iban: DEBTOR_IBAN,
        bic: 'COBADEFFXXX',
      },
      transfers: [
        {
          endToEndId: 'DK-E2E-0001',
          amount: euros('123.45'),
          creditor: {
            name: 'Supplier One',
            iban: CREDITOR_IBAN,
            bic: 'DEUTDEDBFRA',
          },
          remittanceInfo: 'Invoice 2025/DK001',
        },
        {
          endToEndId: 'DK-E2E-0002',
          amount: euros('50.00'),
          creditor: {
            name: 'Supplier Two',
            iban: CREDITOR_IBAN2,
          },
        },
      ],
    },
  ],
}

const DK_DOC_NO_BIC: CreditTransferDocument = {
  messageId: 'DK-TEST-002',
  createdAt: '2025-02-01T10:00:00Z',
  initiatingParty: 'DK Test Corp',
  batches: [
    {
      id: 'DK-BATCH-002',
      executionDate: '2025-02-10',
      debtor: {
        name: 'DK Test Corp',
        iban: DEBTOR_IBAN,
        // No BIC: writer must emit NOTPROVIDED for DbtrAgt
      },
      transfers: [
        {
          endToEndId: 'DK-E2E-0003',
          amount: euros('75.00'),
          creditor: {
            name: 'Recipient',
            iban: CREDITOR_IBAN,
          },
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Task 1 WRITE: writeCreditTransfer with variant='pain.001.003.03' produces XSD-valid XML
// ---------------------------------------------------------------------------

describe('DK variant write: XSD validation', () => {
  it('writeCreditTransfer({ variant: "pain.001.003.03" }) validates against the DK XSD (with BIC)', async () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('writeCreditTransfer({ variant: "pain.001.003.03" }) validates against the DK XSD (no debtor BIC, uses NOTPROVIDED)', async () => {
    const xml = writeCreditTransfer(DK_DOC_NO_BIC, { variant: 'pain.001.003.03' })
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('output contains DK namespace', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pain.001.003.03')
  })

  it('ReqdExctnDt is a plain date (no <Dt> wrapper) in DK output', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    // Should have plain <ReqdExctnDt>2025-01-20</ReqdExctnDt>, not <ReqdExctnDt><Dt>...
    expect(xml).toMatch(/<ReqdExctnDt>2025-01-20<\/ReqdExctnDt>/)
    expect(xml).not.toContain('<Dt>')
  })

  it('DbtrAgt uses <BIC> element (not <BICFI>) in DK output', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    expect(xml).toContain('<BIC>COBADEFFXXX</BIC>')
    // BICFI should not appear anywhere in DK output
    expect(xml).not.toContain('BICFI')
  })

  it('CdtrAgt uses <BIC> element when creditor has a BIC', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    expect(xml).toContain('<BIC>DEUTDEDBFRA</BIC>')
  })

  it('CdtrAgt is omitted when creditor has no BIC', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    // Second transfer has no BIC: no CdtrAgt block for that transfer
    // The first transfer has a BIC; the second does not. We verify the output
    // has exactly one CdtrAgt block (for the first transfer).
    const cdtrAgtMatches = xml.match(/<CdtrAgt>/g)
    expect(cdtrAgtMatches).toHaveLength(1)
  })

  it('DbtrAgt emits NOTPROVIDED when debtor.bic is absent', () => {
    const xml = writeCreditTransfer(DK_DOC_NO_BIC, { variant: 'pain.001.003.03' })
    expect(xml).toContain('<Othr>')
    expect(xml).toContain('<Id>NOTPROVIDED</Id>')
  })
})

// ---------------------------------------------------------------------------
// Task 1 WRITE + profile: variant and profile options work together
// ---------------------------------------------------------------------------

describe('DK variant write: profile option coexists with variant', () => {
  it('batchBooking profile option applies to DK output', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, {
      variant: 'pain.001.003.03',
      profile: { id: 'test-dk', output: { batchBooking: true } },
    })
    expect(xml).toContain('<BtchBookg>true</BtchBookg>')
    // Must still be XSD-valid with BtchBookg
    // (async check is in a separate test to avoid mixing sync/async concerns)
  })

  it('batchBooking DK output is still XSD-valid', async () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, {
      variant: 'pain.001.003.03',
      profile: { id: 'test-dk', output: { batchBooking: true } },
    })
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Task 2 READ / round-trip: parse(writeCreditTransfer(doc, { variant: 'pain.001.003.03' }))
// ---------------------------------------------------------------------------

describe('DK variant round-trip: write then parse', () => {
  it('parse returns ok=true with type="pain.001"', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    const result = parse(xml)
    expect(result.ok, result.ok ? '' : (result as { error: string }).error).toBe(true)
    if (!result.ok) throw new Error('unexpected parse failure')
    expect(result.type).toBe('pain.001')
  })

  it('version is "pain.001.003.03"', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.version).toBe('pain.001.003.03')
  })

  it('messageId round-trips', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.messageId).toBe('DK-TEST-001')
  })

  it('initiatingParty round-trips', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.initiatingParty).toBe('DK Test Corp')
  })

  it('executionDate round-trips (plain date, no <Dt> wrapper)', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.executionDate).toBe('2025-01-20')
  })

  it('debtor IBAN round-trips', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.debtor.iban).toBe(DEBTOR_IBAN)
  })

  it('debtor BIC round-trips (DK uses <BIC>, parser handles both BIC and BICFI)', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.debtor.bic).toBe('COBADEFFXXX')
  })

  it('transfer amounts round-trip', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    const transfers = result.data.batches[0]?.transfers
    expect(transfers).toHaveLength(2)
    expect(transfers?.[0]?.amount.minorUnits).toBe(12345n)
    expect(transfers?.[1]?.amount.minorUnits).toBe(5000n)
  })

  it('creditor IBANs round-trip', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    const transfers = result.data.batches[0]?.transfers
    expect(transfers?.[0]?.creditor.iban).toBe(CREDITOR_IBAN)
    expect(transfers?.[1]?.creditor.iban).toBe(CREDITOR_IBAN2)
  })

  it('creditor BIC round-trips when present', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.transfers[0]?.creditor.bic).toBe('DEUTDEDBFRA')
  })

  it('creditor BIC is absent when not set (no CdtrAgt emitted)', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.transfers[1]?.creditor.bic).toBeUndefined()
  })

  it('remittanceInfo round-trips', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.003.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.transfers[0]?.remittanceInfo).toBe('Invoice 2025/DK001')
    expect(result.data.batches[0]?.transfers[1]?.remittanceInfo).toBeUndefined()
  })

  it('debtor.bic=undefined round-trips cleanly (NOTPROVIDED is parsed as absent bic)', () => {
    const xml = writeCreditTransfer(DK_DOC_NO_BIC, { variant: 'pain.001.003.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    // debtor.bic was undefined, writer emitted NOTPROVIDED, parser sees no BIC/BICFI -> undefined
    expect(result.data.batches[0]?.debtor.bic).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Parse the vendored sepa_king DK sample and assert concrete fields
// ---------------------------------------------------------------------------

describe('DK variant: parse vendored sepa_king.pain.001.003.03.xml', () => {
  it('parses to ok=true with type="pain.001"', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.001.003.03.xml'), 'utf-8')
    const result = parse(xml)
    expect(result.ok, result.ok ? '' : (result as { error: string }).error).toBe(true)
    if (!result.ok) throw new Error('unexpected parse failure')
    expect(result.type).toBe('pain.001')
  })

  it('messageId is "Message-ID-4711"', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.001.003.03.xml'), 'utf-8')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.messageId).toBe('Message-ID-4711')
  })

  it('initiatingParty is "Initiator Name"', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.001.003.03.xml'), 'utf-8')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.initiatingParty).toBe('Initiator Name')
  })

  it('executionDate is "2010-11-25" (plain date, no <Dt> wrapper)', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.001.003.03.xml'), 'utf-8')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.executionDate).toBe('2010-11-25')
  })

  it('debtor IBAN is DE87200500001234567890', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.001.003.03.xml'), 'utf-8')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.debtor.iban).toBe('DE87200500001234567890')
  })

  it('debtor BIC is BANKDEFFXXX (parsed from <BIC> element)', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.001.003.03.xml'), 'utf-8')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.debtor.bic).toBe('BANKDEFFXXX')
  })

  it('two transfers are present', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.001.003.03.xml'), 'utf-8')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.transfers).toHaveLength(2)
  })

  it('first transfer amount is 654314 minorUnits (6543.14 EUR)', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.001.003.03.xml'), 'utf-8')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    const tx0 = result.data.batches[0]?.transfers[0]
    expect(tx0?.amount.minorUnits).toBe(654314n)
    expect(tx0?.amount.currencyCode).toBe('EUR')
  })

  it('second transfer amount is 11272 minorUnits (112.72 EUR)', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.001.003.03.xml'), 'utf-8')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    const tx1 = result.data.batches[0]?.transfers[1]
    expect(tx1?.amount.minorUnits).toBe(11272n)
  })

  it('first transfer creditor IBAN is DE21500500009876543210', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.001.003.03.xml'), 'utf-8')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.transfers[0]?.creditor.iban).toBe('DE21500500009876543210')
  })

  it('first transfer creditor BIC is SPUEDE2UXXX (from <BIC> element)', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.001.003.03.xml'), 'utf-8')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.transfers[0]?.creditor.bic).toBe('SPUEDE2UXXX')
  })

  it('first transfer endToEndId is "OriginatorID1234"', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.001.003.03.xml'), 'utf-8')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.transfers[0]?.endToEndId).toBe('OriginatorID1234')
  })

  it('remittanceInfo is present on both transfers', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.001.003.03.xml'), 'utf-8')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.transfers[0]?.remittanceInfo).toBe(
      'Unstructured Remittance Information'
    )
    expect(result.data.batches[0]?.transfers[1]?.remittanceInfo).toBe(
      'Unstructured Remittance Information'
    )
  })
})

// ---------------------------------------------------------------------------
// Confirm default variant output (.09) is unchanged
// ---------------------------------------------------------------------------

describe('DK variant: default pain.001.001.09 output is unchanged', () => {
  it('no variant option produces pain.001.001.09 namespace', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC)
    expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pain.001.001.09')
    expect(xml).not.toContain('pain.001.003.03')
  })

  it('explicit variant="pain.001.001.09" produces pain.001.001.09 namespace', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC, { variant: 'pain.001.001.09' })
    expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pain.001.001.09')
  })

  it('default output uses <BICFI> (not <BIC>)', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC)
    expect(xml).toContain('<BICFI>COBADEFFXXX</BICFI>')
    expect(xml).not.toContain('<BIC>')
  })

  it('default output wraps ReqdExctnDt in <Dt>', () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC)
    expect(xml).toContain('<Dt>2025-01-20</Dt>')
  })

  it('default output is XSD-valid against pain.001.001.09', async () => {
    const xml = writeCreditTransfer(DK_DOC_WITH_BIC)
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })
})
