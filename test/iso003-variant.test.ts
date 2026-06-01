/**
 * Tests for the ISO pain.001.001.03 write variant.
 *
 * pain.001.001.03 is the legacy ISO 20022 Credit Transfer Initiation format,
 * used by systems that still require the older wire format. It has a different
 * structure from pain.001.001.09:
 *   - Namespace: urn:iso:std:iso:20022:tech:xsd:pain.001.001.03
 *   - ReqdExctnDt is a plain ISODate (no <Dt> wrapper)
 *   - FinInstnId uses <BIC> element (not <BICFI>)
 *   - DbtrAgt is required: when debtor.bic is absent, emits empty <FinInstnId/>
 *     (all children of FinancialInstitutionIdentification7 are optional in the XSD)
 *   - CdtrAgt (transaction level) is optional: omitted when creditor.bic is absent
 *
 * The .001.03 XSD at schemas/iso20022/pain.001.001.03.xsd is the correctness oracle.
 *
 * Round-trip notes:
 *   - debtor.bic present: round-trips cleanly (parser reads <BIC> as bic field).
 *   - debtor.bic absent: writer emits empty <FinInstnId/>; parser finds no BIC or
 *     BICFI child, so bic returns as undefined. Round-trip is clean.
 *   - creditor.bic absent: CdtrAgt is omitted; parser gets undefined bic. Clean.
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/parser/parser.js'
import { validateXsd } from '../src/xsd.js'
import { writeCreditTransfer } from '../src/writer/writer.js'
import { euros } from '../src/model/schema.js'
import { buildIban } from '../src/model/iban.js'
import { sanitizeSepa } from '../src/model/charset.js'
import type { CreditTransferDocument, PostalAddress } from '../src/model/schema.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SNAPSHOTS_DIR = join(__dirname, 'golden/snapshots')

// ---------------------------------------------------------------------------
// Test documents
// ---------------------------------------------------------------------------

const DEBTOR_IBAN = 'DE89370400440532013000'
const CREDITOR_IBAN = 'DE65200400300234567000'
const CREDITOR_IBAN2 = 'NL91ABNA0417164300'

const ISO03_DOC_WITH_BIC: CreditTransferDocument = {
  messageId: 'ISO03-TEST-001',
  createdAt: '2025-01-15T09:00:00Z',
  initiatingParty: 'ISO 03 Test Corp',
  batches: [
    {
      id: 'ISO03-BATCH-001',
      executionDate: '2025-01-20',
      debtor: {
        name: 'ISO 03 Test Corp',
        iban: DEBTOR_IBAN,
        bic: 'COBADEFFXXX',
      },
      transfers: [
        {
          endToEndId: 'ISO03-E2E-0001',
          amount: euros('123.45'),
          creditor: {
            name: 'Supplier One',
            iban: CREDITOR_IBAN,
            bic: 'DEUTDEDBFRA',
          },
          remittanceInfo: 'Invoice 2025/ISO001',
        },
        {
          endToEndId: 'ISO03-E2E-0002',
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

const ISO03_DOC_NO_DEBTOR_BIC: CreditTransferDocument = {
  messageId: 'ISO03-TEST-002',
  createdAt: '2025-02-01T10:00:00Z',
  initiatingParty: 'ISO 03 Test Corp',
  batches: [
    {
      id: 'ISO03-BATCH-002',
      executionDate: '2025-02-10',
      debtor: {
        name: 'ISO 03 Test Corp',
        iban: DEBTOR_IBAN,
        // No BIC: writer must emit empty <FinInstnId/>
      },
      transfers: [
        {
          endToEndId: 'ISO03-E2E-0003',
          amount: euros('75.00'),
          creditor: {
            name: 'Recipient',
            iban: CREDITOR_IBAN,
            bic: 'DEUTDEDBFRA',
          },
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// XSD validation tests
// ---------------------------------------------------------------------------

describe('pain.001.001.03 write: XSD validation', () => {
  it('writeCreditTransfer with variant=pain.001.001.03 validates against the .001.03 XSD (with BIC)', async () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('validates when debtor.bic is absent (empty FinInstnId must be XSD-valid)', async () => {
    const xml = writeCreditTransfer(ISO03_DOC_NO_DEBTOR_BIC, { variant: 'pain.001.001.03' })
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('output contains the pain.001.001.03 namespace', () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pain.001.001.03')
    expect(xml).toContain('CstmrCdtTrfInitn')
  })

  it('output does NOT contain the .09 or DK namespace', () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    expect(xml).not.toContain('pain.001.001.09')
    expect(xml).not.toContain('pain.001.003.03')
  })
})

// ---------------------------------------------------------------------------
// Structural delta tests
// ---------------------------------------------------------------------------

describe('pain.001.001.03 write: structural deltas vs pain.001.001.09', () => {
  it('ReqdExctnDt is a plain date value (no <Dt> wrapper)', () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    expect(xml).toContain('<ReqdExctnDt>2025-01-20</ReqdExctnDt>')
    // No <Dt> wrapper should appear
    expect(xml).not.toContain('<Dt>')
  })

  it('DbtrAgt uses <BIC> element (not <BICFI>) when bic is present', () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    expect(xml).toContain('<BIC>COBADEFFXXX</BIC>')
    expect(xml).not.toContain('<BICFI>')
  })

  it('CdtrAgt uses <BIC> element (not <BICFI>) when creditor.bic is present', () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    expect(xml).toContain('<BIC>DEUTDEDBFRA</BIC>')
  })

  it('DbtrAgt emits empty <FinInstnId/> when debtor.bic is absent', () => {
    const xml = writeCreditTransfer(ISO03_DOC_NO_DEBTOR_BIC, { variant: 'pain.001.001.03' })
    expect(xml).toContain('<DbtrAgt>')
    expect(xml).toContain('<FinInstnId/>')
    // Must NOT contain NOTPROVIDED (that is the DK .003.03 pattern, not ISO .001.03)
    expect(xml).not.toContain('NOTPROVIDED')
  })

  it('CdtrAgt is omitted entirely when creditor.bic is absent', () => {
    // In ISO03_DOC_WITH_BIC, transfer 2 has no creditor.bic
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    // The second CdtTrfTxInf (GOLDEN-E2E-0002) should not have a CdtrAgt
    // We verify by checking CdtrAgt appears only once (for the first transfer)
    const cdtrAgtCount = (xml.match(/<CdtrAgt>/g) ?? []).length
    expect(cdtrAgtCount).toBe(1)
  })

  it('SvcLvl/Cd=SEPA is emitted (SEPA rulebook requirement)', () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    expect(xml).toContain('<Cd>SEPA</Cd>')
  })

  it('ChrgBr=SLEV is emitted (SEPA rulebook requirement)', () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    expect(xml).toContain('<ChrgBr>SLEV</ChrgBr>')
  })

  it('Amounts are wrapped in <Amt><InstdAmt Ccy="EUR">...</InstdAmt></Amt>', () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    expect(xml).toContain('<InstdAmt Ccy="EUR">123.45</InstdAmt>')
  })
})

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe('pain.001.001.03 write: parse round-trip', () => {
  it('parse(write(model)) returns ok=true with type="pain.001"', () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    const result = parse(xml)
    expect(result.ok, result.ok ? '' : (result as { error: string }).error).toBe(true)
    if (!result.ok) throw new Error('unexpected parse failure')
    expect(result.type).toBe('pain.001')
  })

  it('parse returns version="pain.001.001.03"', () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.version).toBe('pain.001.001.03')
  })

  it('messageId round-trips', () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.messageId).toBe('ISO03-TEST-001')
  })

  it('executionDate round-trips (plain ISODate, no Dt wrapper)', () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.executionDate).toBe('2025-01-20')
  })

  it('debtor.bic round-trips (parser reads <BIC> element)', () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.debtor.bic).toBe('COBADEFFXXX')
  })

  it('creditor.bic round-trips when present', () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.transfers[0]?.creditor.bic).toBe('DEUTDEDBFRA')
  })

  it('creditor.bic=undefined round-trips cleanly (CdtrAgt omitted, parser returns undefined)', () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.transfers[1]?.creditor.bic).toBeUndefined()
  })

  it('debtor.bic=undefined round-trips cleanly (empty FinInstnId, parser returns undefined)', () => {
    const xml = writeCreditTransfer(ISO03_DOC_NO_DEBTOR_BIC, { variant: 'pain.001.001.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.batches[0]?.debtor.bic).toBeUndefined()
  })

  it('model deep-equals original after write and parse', () => {
    const xml = writeCreditTransfer(ISO03_DOC_WITH_BIC, { variant: 'pain.001.001.03' })
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data).toEqual(ISO03_DOC_WITH_BIC)
  })
})

// ---------------------------------------------------------------------------
// Golden snapshot regression test
// ---------------------------------------------------------------------------

describe('pain.001.001.03 golden snapshot', () => {
  const GOLDEN_DOC: CreditTransferDocument = {
    messageId: 'GOLDEN-CT-001-03',
    createdAt: '2025-01-15T09:00:00Z',
    initiatingParty: 'Golden Test Corp',
    batches: [
      {
        id: 'GOLDEN-BATCH-01',
        executionDate: '2025-01-20',
        debtor: {
          name: 'Golden Test Corp',
          iban: 'DE89370400440532013000',
          bic: 'COBADEFFXXX',
        },
        transfers: [
          {
            endToEndId: 'GOLDEN-E2E-0001',
            amount: euros('123.45'),
            creditor: {
              name: 'Supplier One',
              iban: 'DE65200400300234567000',
              bic: 'DEUTDEDBFRA',
            },
            remittanceInfo: 'Invoice 2025/001',
          },
          {
            endToEndId: 'GOLDEN-E2E-0002',
            amount: euros('0.01'),
            creditor: {
              name: 'Supplier Two',
              iban: 'FR7630006000011234567890189',
            },
          },
        ],
      },
      {
        id: 'GOLDEN-BATCH-02',
        executionDate: '2025-02-01',
        debtor: {
          name: 'Golden Test Corp',
          iban: 'DE89370400440532013000',
        },
        transfers: [
          {
            endToEndId: 'GOLDEN-E2E-0003',
            amount: euros('999.99'),
            creditor: {
              name: 'Large Vendor',
              iban: 'NL91ABNA0417164300',
            },
            remittanceInfo: 'Q1 service fee',
          },
        ],
      },
    ],
  }

  it('snapshot is XSD-valid against pain.001.001.03', async () => {
    const snapshot = readFileSync(join(SNAPSHOTS_DIR, 'pain.001.001.03.xml'), 'utf-8')
    const result = await validateXsd(snapshot)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })

  it('current writer output matches the committed snapshot (regression guard)', () => {
    const snapshot = readFileSync(join(SNAPSHOTS_DIR, 'pain.001.001.03.xml'), 'utf-8')
    const generated = writeCreditTransfer(GOLDEN_DOC, { variant: 'pain.001.001.03' })
    expect(generated).toBe(snapshot)
  })

  it('snapshot round-trips through parse', () => {
    const snapshot = readFileSync(join(SNAPSHOTS_DIR, 'pain.001.001.03.xml'), 'utf-8')
    const result = parse(snapshot)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('parse failed: ' + result.error)
    expect(result.type).toBe('pain.001')
    if (result.type !== 'pain.001') throw new Error('unexpected type')
    expect(result.data).toEqual(GOLDEN_DOC)
  })
})

// ---------------------------------------------------------------------------
// Shared arbitraries (subset mirrored from xsd-oracle.test.ts)
// ---------------------------------------------------------------------------

const IBAN_COUNTRIES: Array<[string, number]> = [
  ['DE', 18],
  ['FR', 23],
  ['NL', 14],
  ['ES', 20],
  ['IT', 23],
  ['AT', 16],
  ['BE', 12],
  ['PT', 21],
  ['FI', 14],
  ['LU', 16],
]

function arbIban(): fc.Arbitrary<string> {
  return fc.integer({ min: 0, max: IBAN_COUNTRIES.length - 1 }).chain((idx) => {
    const entry = IBAN_COUNTRIES[idx]
    if (entry === undefined) throw new Error(`index out of range: ${idx}`)
    const [country, bbanLen] = entry
    return fc
      .array(fc.integer({ min: 0, max: 9 }), { minLength: bbanLen, maxLength: bbanLen })
      .map((digits) => buildIban(country, digits.join('')))
  })
}

const SEPA_CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /-?:().,'+"

function arbSepaText(minLen: number, maxLen: number): fc.Arbitrary<string> {
  return fc
    .stringOf(fc.constantFrom(...SEPA_CHARSET.split('')), { minLength: minLen, maxLength: maxLen })
    .map((s) => s.trim())
    .filter((s) => s.length >= minLen)
}

// Identifier fields (MsgId, PmtInfId, EndToEndId) must not start/end with '/'
// nor contain '//' per the EPC slash rule, so strip those from generated ids.
function arbSepaIdentifier(minLen: number, maxLen: number): fc.Arbitrary<string> {
  return (
    arbSepaText(minLen, maxLen)
      // Strip leading/trailing/double slashes, then trim again: removing an outer
      // slash can expose leading/trailing whitespace, which would not survive the
      // XML round-trip.
      .map((s) =>
        s
          .replace(/^\/+/, '')
          .replace(/\/+$/, '')
          .replace(/\/{2,}/g, '/')
          .trim()
      )
      .filter((s) => s.length >= minLen)
  )
}

function arbSanitizedSepaText(minLen: number, maxLen: number): fc.Arbitrary<string> {
  const extendedLatin = 'äöüÄÖÜßàáâãåæèéêëìíîïðñòóôõøùúûýÿÀÁÂÃÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕØÙÚÛÝþÞçÇ'
  const droppedSamples = '🎉🥳🌍你好مرحباПривет'
  const mixedCharset = SEPA_CHARSET + extendedLatin + droppedSamples
  return fc
    .stringOf(fc.constantFrom(...[...mixedCharset]), {
      minLength: minLen + 5,
      maxLength: maxLen + 20,
    })
    .map((s) => sanitizeSepa(s))
    .filter((s) => s.length >= minLen && s.length <= maxLen)
}

function arbCreatedAt(): fc.Arbitrary<string> {
  return fc
    .record({
      year: fc.integer({ min: 2020, max: 2035 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 0, max: 59 }),
      second: fc.integer({ min: 0, max: 59 }),
    })
    .map(
      ({ year, month, day, hour, minute, second }) =>
        `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` +
        `T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}Z`
    )
}

function arbDate(): fc.Arbitrary<string> {
  return fc
    .record({
      year: fc.integer({ min: 2024, max: 2035 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
    })
    .map(
      ({ year, month, day }) =>
        `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    )
}

function arbPartyName(): fc.Arbitrary<string> {
  return fc.oneof(arbSepaText(1, 70), arbSanitizedSepaText(1, 70))
}

function arbBic(): fc.Arbitrary<string> {
  return fc.constantFrom('COBADEFFXXX', 'BNPAFRPPXXX', 'DEUTDEDBFRA', 'INGBNL2AXXX', 'BSCHESMMXXX')
}

function arbMoney(): fc.Arbitrary<{ currencyCode: 'EUR'; minorUnits: bigint }> {
  return fc.oneof(
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: 1n }),
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: 99n }),
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: 100n }),
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: 100_000n }),
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: 999_999_999n }),
    fc
      .bigInt({ min: 1n, max: 99_999_999_999n })
      .map((n) => ({ currencyCode: 'EUR' as const, minorUnits: n }))
  )
}

/**
 * Optional full structured address for pain.001.001.03, which uses PostalAddress6.
 * PostalAddress6 supports the same field subset and element order as our emitPstlAdr
 * (StrtNm, BldgNb, PstCd, TwnNm, CtrySubDvsn, Ctry, AdrLine), so the full model
 * address is valid here. All text uses the trimmed SEPA charset to survive round-trip.
 */
function arbPostalAddress6(): fc.Arbitrary<PostalAddress> {
  return fc
    .record({
      streetName: fc.option(arbSepaText(1, 70), { nil: undefined }),
      buildingNumber: fc.option(arbSepaText(1, 16), { nil: undefined }),
      postCode: fc.option(arbSepaText(1, 16), { nil: undefined }),
      townName: fc.option(arbSepaText(1, 35), { nil: undefined }),
      countrySubDivision: fc.option(arbSepaText(1, 35), { nil: undefined }),
      country: fc.option(fc.constantFrom('DE', 'FR', 'NL', 'ES', 'IT', 'BE', 'AT'), {
        nil: undefined,
      }),
      addressLines: fc.option(fc.array(arbSepaText(1, 70), { minLength: 1, maxLength: 7 }), {
        nil: undefined,
      }),
    })
    .map((a) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(a)) {
        if (v !== undefined) out[k] = v
      }
      return out as PostalAddress
    })
    .filter((a) => Object.keys(a).length > 0)
}

function arbAccountParty() {
  return fc
    .record({
      name: arbPartyName(),
      iban: arbIban(),
      bic: fc.option(arbBic(), { nil: undefined }),
      address: fc.option(arbPostalAddress6(), { nil: undefined }),
    })
    .map((p) => {
      const { address, ...rest } = p
      const base: Record<string, unknown> = { ...rest }
      if (base['bic'] === undefined) delete base['bic']
      if (address !== undefined) base['address'] = address
      return base
    })
}

function arbTransfer() {
  return fc
    .record({
      endToEndId: arbSepaIdentifier(1, 35),
      amount: arbMoney(),
      creditor: arbAccountParty(),
      remittanceInfo: fc.option(arbSepaText(1, 140), { nil: undefined }),
    })
    .map((tx) => {
      if (tx.remittanceInfo === undefined) {
        const { remittanceInfo: _ri, ...rest } = tx
        return rest
      }
      return tx
    })
}

function arbPaymentBatch() {
  return fc.record({
    id: arbSepaIdentifier(1, 35),
    executionDate: arbDate(),
    debtor: arbAccountParty(),
    transfers: fc.array(arbTransfer(), { minLength: 1, maxLength: 5 }),
  })
}

function arbCreditTransferDocument(): fc.Arbitrary<CreditTransferDocument> {
  return fc.record({
    messageId: arbSepaIdentifier(1, 35),
    createdAt: arbCreatedAt(),
    initiatingParty: arbPartyName(),
    batches: fc.array(arbPaymentBatch(), { minLength: 1, maxLength: 3 }),
  })
}

// ---------------------------------------------------------------------------
// XSD-oracle property test (numRuns=200)
// ---------------------------------------------------------------------------

describe('XSD Oracle: pain.001.001.03 (numRuns=200)', () => {
  it('property: forAll valid models, writeCreditTransfer(model, { variant: "pain.001.001.03" }) produces XSD-valid XML', async () => {
    const failures: string[] = []
    let runCount = 0

    await fc.assert(
      fc.asyncProperty(arbCreditTransferDocument(), async (doc) => {
        runCount++
        const xml = writeCreditTransfer(doc, { variant: 'pain.001.001.03' })
        const result = await validateXsd(xml)

        if (!result.valid) {
          failures.push(
            `Run ${runCount}: XSD error: ${result.errors.join(', ')}\nXML:\n${xml.slice(0, 500)}`
          )
        }

        return result.valid
      }),
      {
        numRuns: 200,
        verbose: false,
        reporter: ({ failed, counterexample, error }) => {
          if (failed) {
            throw new Error(
              `Property failed after ${runCount} runs.\n` +
                `Last failures:\n${failures.slice(-3).join('\n---\n')}\n` +
                `Counterexample: ${JSON.stringify(counterexample, (_, v) =>
                  typeof v === 'bigint' ? v.toString() + 'n' : v
                )}\n` +
                (error ? `Error: ${error}` : '')
            )
          }
        },
      }
    )

    expect(runCount).toBeGreaterThanOrEqual(200)
  })
})

// ---------------------------------------------------------------------------
// Round-trip property test (numRuns=200)
// ---------------------------------------------------------------------------

describe('Round-trip: pain.001.001.03 model -> write -> parse -> deep-equal (numRuns=200)', () => {
  it('property: forAll valid models, parse(writeCreditTransfer(model, { variant: "pain.001.001.03" })) deep-equals original', () => {
    let runCount = 0

    fc.assert(
      fc.property(arbCreditTransferDocument(), (doc) => {
        runCount++
        const xml = writeCreditTransfer(doc, { variant: 'pain.001.001.03' })
        const result = parse(xml)

        if (!result.ok) {
          throw new Error(
            `parse() failed on valid model at run ${runCount}: ${result.error}\nXML:\n${xml.slice(0, 500)}`
          )
        }

        if (result.type !== 'pain.001') {
          throw new Error(`Expected type "pain.001" but got "${result.type}"`)
        }

        expect(result.data).toEqual(doc)
        return true
      }),
      {
        numRuns: 200,
        verbose: false,
      }
    )

    expect(runCount).toBeGreaterThanOrEqual(200)
  })
})
