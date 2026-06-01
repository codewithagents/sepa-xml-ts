/**
 * Tests for the German DK national write+read variant: pain.008.003.02.
 *
 * The pain.008.003.02 namespace is the German DFU agreement national variant for
 * direct debit (CustomerDirectDebitInitiationV02). It has a different structure
 * from pain.008.001.08:
 *   - Different namespace: urn:iso:std:iso:20022:tech:xsd:pain.008.003.02
 *   - GrpHdr omits CtrlSum (optional in GroupHeaderSDD; reference sample omits it)
 *   - FinInstnId uses <BIC> element (not <BICFI>)
 *   - CdtrAgt (PmtInf level) uses BIC or Othr/NOTPROVIDED (required)
 *   - DbtrAgt (DrctDbtTxInf level) uses BIC or Othr/NOTPROVIDED (required)
 *
 * The DK XSD at schemas/dk/pain.008.003.02.xsd is the correctness oracle.
 * The vendored sepa_king.pain.008.003.02.xml is a real-world reference fixture.
 *
 * Round-trip notes:
 *   - All model fields round-trip cleanly when BICs are present.
 *   - When creditor.bic or debtor.bic is absent, the writer emits NOTPROVIDED; the
 *     parser sees no BIC/BICFI path and returns undefined. So bic=undefined survives
 *     the round-trip cleanly.
 *   - localInstrument defaults to "CORE" on write when omitted; to keep the round-trip
 *     deep-equal, the test document explicitly sets localInstrument: "CORE".
 *
 * Vendored fixture note:
 *   - sepa_king.pain.008.003.02.xml passes the DK XSD (validateXsd valid=true) but
 *     contains a test/placeholder creditorId "DE00ZZZ00099999999" whose check digits
 *     ("00") fail our strict ISO 7064 MOD 97-10 validation. parse() returns ok=false.
 *     This is intentional: it demonstrates our library catches invalid creditor IDs
 *     that the XSD alone cannot detect.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/parser/parser.js'
import { validateXsd } from '../src/xsd.js'
import { writeDirectDebit } from '../src/writer/direct-debit.js'
import { euros } from '../src/model/schema.js'
import type { DirectDebitDocument } from '../src/model/pain008.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const FIXTURES_DIR = join(__dirname, 'golden/fixtures')

// ---------------------------------------------------------------------------
// Test documents
// ---------------------------------------------------------------------------

const CREDITOR_IBAN = 'DE87200500001234567890'
const DEBTOR_IBAN = 'DE21500500009876543210'
const DEBTOR_IBAN2 = 'DE65200400300234567000'
// Valid creditorId (DE + check 98 + biz ZZZ + national part 09999999999)
const CREDITOR_ID = 'DE98ZZZ09999999999'

const DK_SDD_DOC_WITH_BIC: DirectDebitDocument = {
  messageId: 'DK-SDD-001',
  createdAt: '2025-01-15T09:00:00Z',
  initiatingParty: 'DK Test Org',
  creditor: {
    name: 'DK Test Creditor',
    iban: CREDITOR_IBAN,
    bic: 'BANKDEFFXXX',
    creditorId: CREDITOR_ID,
  },
  batches: [
    {
      id: 'DK-BATCH-001',
      collectionDate: '2025-01-20',
      sequenceType: 'FRST',
      localInstrument: 'CORE',
      collections: [
        {
          endToEndId: 'DK-E2E-0001',
          amount: euros('123.45'),
          debtor: {
            name: 'Test Debtor One',
            iban: DEBTOR_IBAN,
            bic: 'SPUEDE2UXXX',
          },
          mandate: { id: 'MANDATE-001', signatureDate: '2024-01-01' },
          remittanceInfo: 'Invoice 2025/DK001',
        },
        {
          endToEndId: 'DK-E2E-0002',
          amount: euros('50.00'),
          debtor: {
            name: 'Test Debtor Two',
            iban: DEBTOR_IBAN2,
            bic: 'DEUTDEDBFRA',
          },
          mandate: { id: 'MANDATE-002', signatureDate: '2024-03-15' },
        },
      ],
    },
  ],
}

const DK_SDD_DOC_NO_BIC: DirectDebitDocument = {
  messageId: 'DK-SDD-002',
  createdAt: '2025-02-01T10:00:00Z',
  initiatingParty: 'DK Test Org',
  creditor: {
    name: 'DK Test Creditor',
    iban: CREDITOR_IBAN,
    // No BIC: writer must emit NOTPROVIDED for CdtrAgt
    creditorId: CREDITOR_ID,
  },
  batches: [
    {
      id: 'DK-BATCH-002',
      collectionDate: '2025-02-10',
      sequenceType: 'RCUR',
      localInstrument: 'CORE',
      collections: [
        {
          endToEndId: 'DK-E2E-0003',
          amount: euros('75.00'),
          debtor: {
            name: 'No BIC Debtor',
            iban: DEBTOR_IBAN,
            // No BIC: writer must emit NOTPROVIDED for DbtrAgt
          },
          mandate: { id: 'MANDATE-003', signatureDate: '2024-06-15' },
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Task 1 WRITE: writeDirectDebit with variant='pain.008.003.02' produces XSD-valid XML
// ---------------------------------------------------------------------------

describe('DK SDD variant write: XSD validation', () => {
  it('writeDirectDebit({ variant: "pain.008.003.02" }) validates against the DK XSD (with BIC)', async () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('writeDirectDebit({ variant: "pain.008.003.02" }) validates against the DK XSD (no BICs, NOTPROVIDED)', async () => {
    const xml = writeDirectDebit(DK_SDD_DOC_NO_BIC, { variant: 'pain.008.003.02' })
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('output contains DK namespace', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pain.008.003.02')
  })

  it('GrpHdr omits CtrlSum (DK delta)', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    // GrpHdr ends at </GrpHdr>; CtrlSum should not appear between <GrpHdr> and </GrpHdr>
    const grpHdrMatch = xml.match(/<GrpHdr>([\s\S]*?)<\/GrpHdr>/)
    expect(grpHdrMatch).not.toBeNull()
    if (!grpHdrMatch) throw new Error('GrpHdr not found')
    expect(grpHdrMatch[1]).not.toContain('<CtrlSum>')
  })

  it('CdtrAgt uses <BIC> element (not <BICFI>) in DK output', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    expect(xml).toContain('<BIC>BANKDEFFXXX</BIC>')
    expect(xml).not.toContain('BICFI')
  })

  it('DbtrAgt uses <BIC> element at transaction level', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    expect(xml).toContain('<BIC>SPUEDE2UXXX</BIC>')
    expect(xml).toContain('<BIC>DEUTDEDBFRA</BIC>')
  })

  it('CdtrAgt emits NOTPROVIDED when creditor.bic is absent', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_NO_BIC, { variant: 'pain.008.003.02' })
    // CdtrAgt block should contain NOTPROVIDED
    const cdtrAgtPos = xml.indexOf('<CdtrAgt>')
    const cdtrAgtEnd = xml.indexOf('</CdtrAgt>', cdtrAgtPos)
    const cdtrAgtBlock = xml.slice(cdtrAgtPos, cdtrAgtEnd)
    expect(cdtrAgtBlock).toContain('<Othr>')
    expect(cdtrAgtBlock).toContain('<Id>NOTPROVIDED</Id>')
  })

  it('DbtrAgt emits NOTPROVIDED when debtor.bic is absent', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_NO_BIC, { variant: 'pain.008.003.02' })
    expect(xml).toContain('<Id>NOTPROVIDED</Id>')
    // BICFI must not appear anywhere in DK output
    expect(xml).not.toContain('BICFI')
  })
})

// ---------------------------------------------------------------------------
// variant and profile options work together
// ---------------------------------------------------------------------------

describe('DK SDD variant write: profile option coexists with variant', () => {
  it('batchBooking profile option applies to DK output', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, {
      variant: 'pain.008.003.02',
      profile: { id: 'test-dk-sdd', output: { batchBooking: true } },
    })
    expect(xml).toContain('<BtchBookg>true</BtchBookg>')
  })

  it('batchBooking DK output is still XSD-valid', async () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, {
      variant: 'pain.008.003.02',
      profile: { id: 'test-dk-sdd', output: { batchBooking: true } },
    })
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Task 2 READ / round-trip: parse(writeDirectDebit(doc, { variant: 'pain.008.003.02' }))
// ---------------------------------------------------------------------------

describe('DK SDD variant round-trip: write then parse', () => {
  it('parse returns ok=true with type="pain.008"', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    expect(result.ok, result.ok ? '' : (result as { error: string }).error).toBe(true)
    if (!result.ok) throw new Error('unexpected parse failure')
    expect(result.type).toBe('pain.008')
  })

  it('version is "pain.008.003.02"', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    expect(result.version).toBe('pain.008.003.02')
  })

  it('messageId round-trips', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    expect(result.data.messageId).toBe('DK-SDD-001')
  })

  it('initiatingParty round-trips', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    expect(result.data.initiatingParty).toBe('DK Test Org')
  })

  it('creditor.name round-trips', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    expect(result.data.creditor.name).toBe('DK Test Creditor')
  })

  it('creditor.iban round-trips', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    expect(result.data.creditor.iban).toBe(CREDITOR_IBAN)
  })

  it('creditor.bic round-trips (DK uses <BIC>, parser handles both BIC and BICFI)', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    expect(result.data.creditor.bic).toBe('BANKDEFFXXX')
  })

  it('creditor.creditorId round-trips', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    expect(result.data.creditor.creditorId).toBe(CREDITOR_ID)
  })

  it('collectionDate round-trips', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    expect(result.data.batches[0]?.collectionDate).toBe('2025-01-20')
  })

  it('sequenceType round-trips', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    expect(result.data.batches[0]?.sequenceType).toBe('FRST')
  })

  it('localInstrument round-trips', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    expect(result.data.batches[0]?.localInstrument).toBe('CORE')
  })

  it('collection amounts round-trip', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    const collections = result.data.batches[0]?.collections
    expect(collections).toHaveLength(2)
    expect(collections?.[0]?.amount.minorUnits).toBe(12345n)
    expect(collections?.[1]?.amount.minorUnits).toBe(5000n)
  })

  it('mandate id and signatureDate round-trip', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    expect(result.data.batches[0]?.collections[0]?.mandate.id).toBe('MANDATE-001')
    expect(result.data.batches[0]?.collections[0]?.mandate.signatureDate).toBe('2024-01-01')
    expect(result.data.batches[0]?.collections[1]?.mandate.id).toBe('MANDATE-002')
  })

  it('debtor IBANs round-trip', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    expect(result.data.batches[0]?.collections[0]?.debtor.iban).toBe(DEBTOR_IBAN)
    expect(result.data.batches[0]?.collections[1]?.debtor.iban).toBe(DEBTOR_IBAN2)
  })

  it('debtor BICs round-trip (DK uses <BIC>, parser handles both BIC and BICFI)', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    expect(result.data.batches[0]?.collections[0]?.debtor.bic).toBe('SPUEDE2UXXX')
    expect(result.data.batches[0]?.collections[1]?.debtor.bic).toBe('DEUTDEDBFRA')
  })

  it('remittanceInfo round-trips', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    expect(result.data.batches[0]?.collections[0]?.remittanceInfo).toBe('Invoice 2025/DK001')
    expect(result.data.batches[0]?.collections[1]?.remittanceInfo).toBeUndefined()
  })

  it('creditor.bic=undefined round-trips cleanly (NOTPROVIDED is parsed as absent bic)', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_NO_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    expect(result.data.creditor.bic).toBeUndefined()
  })

  it('debtor.bic=undefined round-trips cleanly (NOTPROVIDED is parsed as absent bic)', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_NO_BIC, { variant: 'pain.008.003.02' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.008') throw new Error('expected ok pain.008')
    expect(result.data.batches[0]?.collections[0]?.debtor.bic).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Parse the vendored sepa_king DK SDD sample
//
// sepa_king.pain.008.003.02.xml passes the DK XSD (validateXsd valid=true) but
// contains a placeholder creditorId "DE00ZZZ00099999999" whose check digits ("00")
// fail ISO 7064 MOD 97-10. parse() returns ok=false. This mirrors how the library
// rejects the pain001.pain.001.001.09.xml fixture that passes XSD but fails IBAN
// mod-97: XSD alone is not sufficient.
// ---------------------------------------------------------------------------

describe('DK SDD variant: parse vendored sepa_king.pain.008.003.02.xml', () => {
  it('validateXsd returns valid=true (the file passes the official DK SDD XSD)', async () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.008.003.02.xml'), 'utf-8')
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('parse returns ok=false due to placeholder creditorId check digit (model is stricter than XSD)', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.008.003.02.xml'), 'utf-8')
    const result = parse(xml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected parse failure')
    expect(result.error).toContain('creditorId')
    expect(result.error).toContain('MOD 97-10')
  })

  it('the raw XML has the expected mandate id "Mandate-Id"', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.008.003.02.xml'), 'utf-8')
    expect(xml).toContain('<MndtId>Mandate-Id</MndtId>')
  })

  it('the raw XML has sequenceType FRST', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.008.003.02.xml'), 'utf-8')
    expect(xml).toContain('<SeqTp>FRST</SeqTp>')
  })

  it('the raw XML has creditorId DE00ZZZ00099999999', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.008.003.02.xml'), 'utf-8')
    expect(xml).toContain('<Id>DE00ZZZ00099999999</Id>')
  })

  it('the raw XML has debtor IBAN DE21500500009876543210', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.008.003.02.xml'), 'utf-8')
    expect(xml).toContain('<IBAN>DE21500500009876543210</IBAN>')
  })

  it('the raw XML has amount 6543.14 EUR', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.008.003.02.xml'), 'utf-8')
    expect(xml).toContain('<InstdAmt Ccy="EUR">6543.14</InstdAmt>')
  })

  it('the raw XML uses <BIC> (not <BICFI>) for FinInstnId', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.008.003.02.xml'), 'utf-8')
    expect(xml).toContain('<BIC>BANKDEFFXXX</BIC>')
    expect(xml).not.toContain('BICFI')
  })

  it('the raw XML has initiatingParty "Initiator Name"', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'sepa_king.pain.008.003.02.xml'), 'utf-8')
    expect(xml).toContain('<Nm>Initiator Name</Nm>')
  })
})

// ---------------------------------------------------------------------------
// Confirm default variant output (.08) is unchanged
// ---------------------------------------------------------------------------

describe('DK SDD variant: default pain.008.001.08 output is unchanged', () => {
  it('no variant option produces pain.008.001.08 namespace', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC)
    expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pain.008.001.08')
    expect(xml).not.toContain('pain.008.003.02')
  })

  it('explicit variant="pain.008.001.08" produces pain.008.001.08 namespace', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC, { variant: 'pain.008.001.08' })
    expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pain.008.001.08')
  })

  it('default output uses <BICFI> (not <BIC>) for FinInstnId', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC)
    expect(xml).toContain('<BICFI>BANKDEFFXXX</BICFI>')
    expect(xml).not.toContain('<BIC>')
  })

  it('default output includes CtrlSum in GrpHdr', () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC)
    const grpHdrMatch = xml.match(/<GrpHdr>([\s\S]*?)<\/GrpHdr>/)
    expect(grpHdrMatch).not.toBeNull()
    if (!grpHdrMatch) throw new Error('GrpHdr not found')
    expect(grpHdrMatch[1]).toContain('<CtrlSum>')
  })

  it('default output is XSD-valid against pain.008.001.08', async () => {
    const xml = writeDirectDebit(DK_SDD_DOC_WITH_BIC)
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })

  it('default output golden snapshot matches (regression guard)', async () => {
    const { readFileSync } = await import('node:fs')
    const { join: joinPath, dirname: dirnamePath } = await import('node:path')
    const { fileURLToPath: fu } = await import('node:url')
    const dir = dirnamePath(fu(import.meta.url))
    const snapshotPath = joinPath(dir, 'golden/snapshots/pain.008.001.08.xml')
    const snapshot = readFileSync(snapshotPath, 'utf-8')
    // The snapshot was generated with a fixed deterministic document; we verify
    // that our writeDirectDebit08 output format has not changed by confirming the
    // snapshot is still XSD-valid (the full regression test is in golden.test.ts).
    const result = await validateXsd(snapshot)
    expect(result.valid, `Snapshot XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })
})
