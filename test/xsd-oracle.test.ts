/**
 * Tests for sepa-xml-ts.
 *
 * Contains:
 * 1. Hand-written sample tests (smoke tests, euros/formatMoney helpers)
 * 2. pain.001 XSD-oracle property test: forAll valid models, write -> XSD-valid XML (numRuns >= 200)
 * 3. pain.001 round-trip property test: parse(write(model)) deep-equals original (numRuns >= 200)
 * 4. Hand-written pain.008 sample test: write -> validateXsd valid AND parse -> deep-equal
 * 5. pain.008 XSD-oracle property test (numRuns >= 200)
 * 6. pain.008 round-trip property test (numRuns >= 200)
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { writeCreditTransfer } from '../src/writer/writer.js'
import { writeDirectDebit } from '../src/writer/direct-debit.js'
import { parse } from '../src/parser/parser.js'
import { validateXsd } from '../src/xsd.js'
import { buildIban } from '../src/model/iban.js'
import { sanitizeSepa } from '../src/model/charset.js'
import { buildCreditorId, isValidCreditorId } from '../src/model/creditor-id.js'
import { euros, formatMoney } from '../src/model/schema.js'
import type {
  CreditTransferDocument,
  AccountParty,
  Transfer,
  PaymentBatch,
  PostalAddress,
  UltimateParty,
} from '../src/model/schema.js'
import type {
  DirectDebitDocument,
  DirectDebitBatch,
  Collection,
  Creditor,
  SequenceType,
  LocalInstrument,
} from '../src/model/pain008.js'

// ---------------------------------------------------------------------------
// Shared IBAN helpers (used by both pain.001 and pain.008 arbitraries)
// ---------------------------------------------------------------------------

/**
 * Countries with BBAN structures that fit [a-zA-Z0-9]{1,30}.
 * Each entry: [countryCode, bbanLength] where all digits are used (simple).
 */
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

/** Arbitrary that produces a valid IBAN (passes mod-97 checksum). */
function arbIban(): fc.Arbitrary<string> {
  return fc.integer({ min: 0, max: IBAN_COUNTRIES.length - 1 }).chain((idx) => {
    const entry = IBAN_COUNTRIES[idx]
    if (entry === undefined) {
      throw new Error(`IBAN_COUNTRIES index out of range: ${idx}`)
    }
    const [country, bbanLen] = entry
    return fc
      .array(fc.integer({ min: 0, max: 9 }), { minLength: bbanLen, maxLength: bbanLen })
      .map((digits) => {
        const bban = digits.join('')
        return buildIban(country, bban)
      })
  })
}

// ---------------------------------------------------------------------------
// Shared SEPA text helpers
// ---------------------------------------------------------------------------

const SEPA_CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /-?:().,'+"

/** Arbitrary for a clean SEPA text string of the given max length. */
function arbSepaText(minLen: number, maxLen: number): fc.Arbitrary<string> {
  return fc
    .stringOf(fc.constantFrom(...SEPA_CHARSET.split('')), {
      minLength: minLen,
      maxLength: maxLen,
    })
    .map((s) => s.trim())
    .filter((s) => s.length >= minLen)
}

/**
 * Arbitrary for a SEPA identifier string: SEPA charset PLUS EPC slash rules.
 * Must not start or end with '/' and must not contain '//'.
 * Used for MsgId, PmtInfId, and EndToEndId fields.
 */
function arbSepaIdentifier(minLen: number, maxLen: number): fc.Arbitrary<string> {
  return arbSepaText(minLen, maxLen).filter(
    (s) => !s.startsWith('/') && !s.endsWith('/') && !s.includes('//')
  )
}

/**
 * Arbitrary for text that may contain unicode/extended chars but
 * gets sanitized through sanitizeSepa before use.
 *
 * Uses a wider character set including full Latin-1 Supplement, emoji, and
 * a small CJK sample to stress the drop-and-transliterate path.
 */
function arbSanitizedSepaText(minLen: number, maxLen: number): fc.Arbitrary<string> {
  // Extended characters: full Latin-1 Supplement accented letters plus
  // some emoji and CJK samples that will be dropped by sanitizeSepa.
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

// ---------------------------------------------------------------------------
// Shared arbitraries
// ---------------------------------------------------------------------------

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
        `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}` +
        `T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}Z`
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
        `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    )
}

function arbPartyName(): fc.Arbitrary<string> {
  return fc.oneof(arbSepaText(1, 70), arbSanitizedSepaText(1, 70))
}

function arbBic(): fc.Arbitrary<string> {
  return fc.constantFrom('COBADEFFXXX', 'BNPAFRPPXXX', 'DEUTDEDBFRA', 'INGBNL2AXXX', 'BSCHESMMXXX')
}

/**
 * Arbitrary for an optional structured PostalAddress (PstlAdr).
 * Each field is independently optional; the result always has at least one field
 * set (an empty address object is invalid). All text uses the trimmed SEPA charset
 * so it survives the XML round-trip; country is a valid 2-letter code.
 */
function arbPostalAddress(): fc.Arbitrary<PostalAddress> {
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
      // Strip undefined keys so the generated model matches what the parser returns.
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(a)) {
        if (v !== undefined) out[k] = v
      }
      return out as PostalAddress
    })
    .filter((a) => Object.keys(a).length > 0)
}

/** Attach an optional address to a party record, stripping the key when absent. */
function withOptionalAddress<T extends object>(party: T, address: PostalAddress | undefined): T {
  if (address === undefined) return party
  return { ...party, address }
}

/**
 * Arbitrary for an optional UltimateParty (name only, max 70 chars, SEPA charset).
 * Uses arbSepaText to guarantee names survive XML round-trip (no trailing whitespace,
 * SEPA charset only). The fc.option with nil:undefined produces undefined ~50% of
 * the time so the absent-case is well exercised.
 */
function arbUltimateParty(): fc.Arbitrary<UltimateParty | undefined> {
  return fc.option(
    arbSepaText(1, 70).map((name) => ({ name })),
    { nil: undefined }
  )
}

/**
 * EPC AT-06 cap: 999,999,999.99 EUR = 99,999,999,999 cents.
 * All boundary values must be at or below this cap.
 */
const MAX_AMOUNT_MINOR = 99_999_999_999n

function arbMoney(): fc.Arbitrary<{ currencyCode: 'EUR'; minorUnits: bigint }> {
  return fc.oneof(
    // Boundary: minimum (0.01 EUR = 1 cent)
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: 1n }),
    // Boundary: just below 1 EUR
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: 99n }),
    // Boundary: exactly 1 EUR
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: 100n }),
    // Boundary: 1000 EUR
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: 100_000n }),
    // Boundary: large amount (near float precision boundary for naive implementations)
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: 999_999_999n }),
    // Boundary: at the EPC AT-06 cap (999,999,999.99 EUR)
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: MAX_AMOUNT_MINOR }),
    // Boundary: one cent below the cap
    fc.constant({ currencyCode: 'EUR' as const, minorUnits: MAX_AMOUNT_MINOR - 1n }),
    // Random amounts between 1 cent and the EPC AT-06 cap
    fc
      .bigInt({ min: 1n, max: MAX_AMOUNT_MINOR })
      .map((n) => ({ currencyCode: 'EUR' as const, minorUnits: n }))
  )
}

// ---------------------------------------------------------------------------
// pain.001 arbitraries
// ---------------------------------------------------------------------------

function arbAccountParty(): fc.Arbitrary<AccountParty> {
  return fc
    .record({
      name: arbPartyName(),
      iban: arbIban(),
      bic: fc.option(arbBic(), { nil: undefined }),
      address: fc.option(arbPostalAddress(), { nil: undefined }),
    })
    .map((p) => {
      const { address, ...withBic } = p
      const base = withBic.bic === undefined ? (({ bic: _bic, ...rest }) => rest)(withBic) : withBic
      return withOptionalAddress(base as AccountParty, address)
    })
}

function arbTransfer(): fc.Arbitrary<Transfer> {
  return fc
    .record({
      endToEndId: arbSepaIdentifier(1, 35),
      amount: arbMoney(),
      ultimateDebtor: arbUltimateParty(),
      creditor: arbAccountParty(),
      ultimateCreditor: arbUltimateParty(),
      remittanceInfo: fc.option(arbSepaText(1, 140), { nil: undefined }),
    })
    .map((tx) => {
      // Strip undefined keys so the generated model matches what the parser returns
      // (absent ultimate parties must not appear as keys with undefined values).
      const out: Record<string, unknown> = {
        endToEndId: tx.endToEndId,
        amount: tx.amount,
        creditor: tx.creditor,
      }
      if (tx.ultimateDebtor !== undefined) out['ultimateDebtor'] = tx.ultimateDebtor
      if (tx.ultimateCreditor !== undefined) out['ultimateCreditor'] = tx.ultimateCreditor
      if (tx.remittanceInfo !== undefined) out['remittanceInfo'] = tx.remittanceInfo
      return out as Transfer
    })
}

function arbPaymentBatch(): fc.Arbitrary<PaymentBatch> {
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
// pain.008 arbitraries
// ---------------------------------------------------------------------------

/**
 * Arbitrary for a check-digit-valid SEPA Creditor Identifier.
 * Uses buildCreditorId to compute the correct check digits, so every generated
 * value passes the ISO 7064 MOD 97-10 validation wired into CreditorIdSchema.
 *
 * DE creditor identifiers must be exactly 18 chars: 2 (DE) + 2 (check) + 3 (biz) + 11 (national).
 * Other countries use 1..10 char national IDs (total stays under 35).
 */
function arbCreditorId(): fc.Arbitrary<string> {
  // Non-DE countries: any 1..10 char national ID
  const NON_DE_COUNTRIES = ['FR', 'NL', 'AT', 'BE', 'ES', 'IT', 'PT', 'FI', 'LU']
  const ALPHA_NUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const nonDeArb = fc
    .record({
      country: fc.constantFrom(...NON_DE_COUNTRIES),
      nationalId: fc.stringOf(fc.constantFrom(...ALPHA_NUM.split('')), {
        minLength: 1,
        maxLength: 10,
      }),
    })
    .map(({ country, nationalId }) => buildCreditorId(country, 'ZZZ', nationalId))
  // DE: national ID must be exactly 11 chars so total length is exactly 18
  const deArb = fc
    .stringOf(fc.constantFrom(...ALPHA_NUM.split('')), { minLength: 11, maxLength: 11 })
    .map((nationalId) => buildCreditorId('DE', 'ZZZ', nationalId))
  return fc.oneof(nonDeArb, deArb)
}

function arbSequenceType(): fc.Arbitrary<SequenceType> {
  return fc.constantFrom<SequenceType>('FRST', 'RCUR', 'OOFF', 'FNAL')
}

function arbLocalInstrument(): fc.Arbitrary<LocalInstrument> {
  return fc.constantFrom<LocalInstrument>('CORE', 'B2B')
}

function arbCreditor(): fc.Arbitrary<Creditor> {
  return fc
    .record({
      name: arbPartyName(),
      iban: arbIban(),
      bic: fc.option(arbBic(), { nil: undefined }),
      creditorId: arbCreditorId(),
      address: fc.option(arbPostalAddress(), { nil: undefined }),
    })
    .map((c) => {
      const { address, ...withBic } = c
      const base = withBic.bic === undefined ? (({ bic: _bic, ...rest }) => rest)(withBic) : withBic
      return withOptionalAddress(base as Creditor, address)
    })
}

/**
 * Arbitrary for a Collection belonging to a given batch.
 *
 * Two constraints keep generated documents free of R1/R2/R3 violations:
 *
 * R1 (signature before collection): signatureDate is derived from collectionDate
 * so that signatureDate <= collectionDate always holds. The year is drawn from
 * [2000..collectionYear]; if equal, month is drawn from [1..collectionMonth]; if
 * equal, day is drawn from [1..collectionDay]. Lexicographic YYYY-MM-DD comparison
 * is therefore always satisfied.
 *
 * R2/R3 (OOFF single-use, consistent scheme): mandate ids are generated with a
 * minimum length of 10 chars from a 72-char SEPA alphabet (72^10 > 3.7e18
 * possibilities). The birthday-paradox collision probability for 15 collections
 * across 3 batches is < 3e-17, i.e. effectively zero. This makes cross-batch
 * mandate id collisions astronomically unlikely, so R2 and R3 are always satisfied
 * without requiring stateful id tracking.
 */
function arbCollection(collectionDate: string): fc.Arbitrary<Collection> {
  const parts = collectionDate.split('-')
  const cy = parseInt(parts[0]!, 10)
  const cm = parseInt(parts[1]!, 10)
  const cd = parseInt(parts[2]!, 10)

  // Build an arbitrary signatureDate that is always <= collectionDate (R1).
  const arbSignatureDate: fc.Arbitrary<string> = fc
    .integer({ min: 2000, max: cy })
    .chain((yr) => {
      if (yr < cy) {
        // Any month/day is guaranteed to be before the collection year.
        return fc
          .record({
            m: fc.integer({ min: 1, max: 12 }),
            d: fc.integer({ min: 1, max: 28 }),
          })
          .map(
            ({ m, d }) =>
              `${yr}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          )
      }
      // yr === cy: constrain month <= cm to stay within the same year.
      return fc.integer({ min: 1, max: cm }).chain((mo) => {
        // If month is earlier, any day works; if equal month, day must be <= cd.
        const maxDay = mo < cm ? 28 : cd
        return fc
          .integer({ min: 1, max: maxDay })
          .map(
            (d) =>
              `${yr}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          )
      })
    })

  return fc
    .record({
      endToEndId: arbSepaIdentifier(1, 35),
      amount: arbMoney(),
      ultimateCreditor: arbUltimateParty(),
      debtor: fc
        .record({
          name: arbPartyName(),
          iban: arbIban(),
          bic: fc.option(arbBic(), { nil: undefined }),
          address: fc.option(arbPostalAddress(), { nil: undefined }),
        })
        .map((d) => {
          const { address, ...withBic } = d
          const base =
            withBic.bic === undefined ? (({ bic: _bic, ...rest }) => rest)(withBic) : withBic
          return withOptionalAddress(base, address)
        }),
      ultimateDebtor: arbUltimateParty(),
      mandate: fc.record({
        // Minimum 10 chars reduces cross-document collision probability to < 1e-17 (R2/R3).
        // Mandate id is NOT subject to the slash rule (per the EPC rulebook).
        id: arbSepaText(10, 35),
        signatureDate: arbSignatureDate,
      }),
      remittanceInfo: fc.option(arbSepaText(1, 140), { nil: undefined }),
    })
    .map((col) => {
      // Strip undefined keys so the generated model matches what the parser returns
      // (absent ultimate parties must not appear as keys with undefined values).
      const out: Record<string, unknown> = {
        endToEndId: col.endToEndId,
        amount: col.amount,
        debtor: col.debtor,
        mandate: col.mandate,
      }
      if (col.ultimateCreditor !== undefined) out['ultimateCreditor'] = col.ultimateCreditor
      if (col.ultimateDebtor !== undefined) out['ultimateDebtor'] = col.ultimateDebtor
      if (col.remittanceInfo !== undefined) out['remittanceInfo'] = col.remittanceInfo
      return out as Collection
    })
}

function arbDirectDebitBatch(): fc.Arbitrary<DirectDebitBatch> {
  // Chain from collectionDate so that each Collection's signatureDate can be
  // constrained to be <= collectionDate (R1 requirement).
  return fc
    .record({
      id: arbSepaIdentifier(1, 35),
      collectionDate: arbDate(),
      sequenceType: arbSequenceType(),
      // Always explicitly set localInstrument for round-trip correctness:
      // the writer always emits it, so the parser always reads it back.
      // Generating undefined would cause a round-trip mismatch (undefined -> write "CORE" -> parse "CORE").
      localInstrument: arbLocalInstrument(),
    })
    .chain((batchBase) =>
      fc
        .array(arbCollection(batchBase.collectionDate), { minLength: 1, maxLength: 5 })
        .map((collections) => ({ ...batchBase, collections }))
    )
}

function arbDirectDebitDocument(): fc.Arbitrary<DirectDebitDocument> {
  return fc
    .record({
      messageId: arbSepaIdentifier(1, 35),
      createdAt: arbCreatedAt(),
      initiatingParty: arbPartyName(),
      creditor: arbCreditor(),
      batches: fc.array(arbDirectDebitBatch(), { minLength: 1, maxLength: 3 }),
    })
    .map((doc) => {
      // Rewrite every mandate id to a globally unique value so the document
      // always satisfies R2 (OOFF single-use) and R3 (one scheme per mandate)
      // by construction. This removes the rule-violation throw path so the
      // round-trip property only exercises genuine serialize/parse fidelity,
      // and the shrinker cannot manufacture a misleading mandate-collision case.
      const batches = doc.batches.map((batch, bIdx) => ({
        ...batch,
        collections: batch.collections.map((col, cIdx) => ({
          ...col,
          // Slice to 35, then strip any trailing space the slice may have exposed
          // mid-content (a trailing space would not survive the XML round-trip).
          mandate: {
            ...col.mandate,
            id: `MND-${bIdx}-${cIdx}-${col.mandate.id}`.slice(0, 35).replace(/\s+$/, ''),
          },
        })),
      }))
      return { ...doc, batches }
    })
}

// ---------------------------------------------------------------------------
// Hand-written sample tests: euros() and formatMoney() helpers
// ---------------------------------------------------------------------------

describe('euros() and formatMoney() helpers', () => {
  it("euros('0.01') produces minorUnits = 1n", () => {
    const m = euros('0.01')
    expect(m.currencyCode).toBe('EUR')
    expect(m.minorUnits).toBe(1n)
  })

  it("euros('123.45') produces minorUnits = 12345n", () => {
    const m = euros('123.45')
    expect(m.minorUnits).toBe(12345n)
  })

  it("euros('123.4') pads the single decimal to .40 (12340n)", () => {
    const m = euros('123.4')
    expect(m.minorUnits).toBe(12340n)
  })

  it("euros('123') treats integer string as whole euros (12300n)", () => {
    const m = euros('123')
    expect(m.minorUnits).toBe(12300n)
  })

  it("euros('0.00') throws because amount is below minimum", () => {
    expect(() => euros('0.00')).toThrow()
  })

  it("euros('') throws on empty string", () => {
    expect(() => euros('')).toThrow()
  })

  it("euros('1.234') throws on more than 2 decimal places", () => {
    expect(() => euros('1.234')).toThrow()
  })

  it("euros('-1.00') throws on negative string", () => {
    expect(() => euros('-1.00')).toThrow()
  })

  it("euros('abc') throws on non-numeric string", () => {
    expect(() => euros('abc')).toThrow()
  })

  it('formatMoney round-trips with euros()', () => {
    const m = euros('50.75')
    expect(formatMoney(m)).toBe('50.75')
  })

  it('formatMoney always produces exactly 2 decimal places', () => {
    const m = euros('100')
    expect(formatMoney(m)).toBe('100.00')
  })

  it("formatMoney on minimum amount produces '0.01'", () => {
    const m = euros('0.01')
    expect(formatMoney(m)).toBe('0.01')
  })
})

// ---------------------------------------------------------------------------
// pain.001 hand-written sample: write XSD validity and parse round-trip
// ---------------------------------------------------------------------------

describe('pain.001 sample model: write XSD validity and parse round-trip', () => {
  const sampleDoc: CreditTransferDocument = {
    messageId: 'MSG-SAMPLE-001',
    createdAt: '2024-06-01T09:00:00Z',
    initiatingParty: 'Test Company GmbH',
    batches: [
      {
        id: 'BATCH-001',
        executionDate: '2024-06-05',
        debtor: {
          name: 'Test Company GmbH',
          iban: 'DE89370400440532013000',
          bic: 'COBADEFFXXX',
        },
        transfers: [
          {
            endToEndId: 'E2E-0001',
            amount: euros('0.01'),
            creditor: {
              name: 'Supplier One',
              iban: 'DE65200400300234567000',
            },
          },
          {
            endToEndId: 'E2E-0002',
            amount: euros('123.45'),
            creditor: {
              name: 'Supplier Two',
              iban: 'DE65200400300234567000',
              bic: 'DEUTDEDBFRA',
            },
            remittanceInfo: 'Invoice 2024/42',
          },
        ],
      },
      {
        id: 'BATCH-002',
        executionDate: '2024-06-10',
        debtor: {
          name: 'Test Company GmbH',
          iban: 'DE89370400440532013000',
        },
        transfers: [
          {
            endToEndId: 'E2E-0003',
            amount: euros('999.99'),
            creditor: {
              name: 'Large Vendor',
              iban: 'FR7630006000011234567890189',
            },
            remittanceInfo: 'Payment for services',
          },
        ],
      },
    ],
  }

  it('write produces XSD-valid XML', async () => {
    const xml = writeCreditTransfer(sampleDoc)
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('parse(write(model)) deep-equals the original model', () => {
    const xml = writeCreditTransfer(sampleDoc)
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    expect(parsed.type).toBe('pain.001')
    if (parsed.type !== 'pain.001') throw new Error('unexpected type')
    expect(parsed.data).toEqual(sampleDoc)
  })

  it('sanitizes unicode names and still produces valid XSD output', async () => {
    const doc: CreditTransferDocument = {
      messageId: 'UNICODE-TEST-01',
      createdAt: '2024-06-01T09:00:00Z',
      initiatingParty: sanitizeSepa('Müller und Söhne GmbH'),
      batches: [
        {
          id: 'PI-UNICODE-01',
          executionDate: '2024-07-01',
          debtor: {
            name: sanitizeSepa('Schroeder Ueberweisungen AG'),
            iban: 'DE89370400440532013000',
          },
          transfers: [
            {
              endToEndId: 'E2E-UNICODE',
              amount: euros('50.00'),
              creditor: {
                name: sanitizeSepa('Cafe Resume Nonyo'),
                iban: 'DE65200400300234567000',
              },
            },
          ],
        },
      ],
    }

    const xml = writeCreditTransfer(doc)
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// pain.001 XSD Oracle property test
// ---------------------------------------------------------------------------

describe('XSD Oracle: pain.001.001.09', () => {
  it('property: forAll valid models, writeCreditTransfer produces XSD-valid XML (numRuns=200)', async () => {
    const failures: string[] = []
    let runCount = 0

    await fc.assert(
      fc.asyncProperty(arbCreditTransferDocument(), async (doc) => {
        runCount++
        const xml = writeCreditTransfer(doc)
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
// pain.001 round-trip property test
// ---------------------------------------------------------------------------

describe('Round-trip: pain.001 model -> write -> parse -> deep-equal (numRuns=200)', () => {
  it('property: forAll valid models, parse(writeCreditTransfer(model)) deep-equals original (numRuns=200)', () => {
    let runCount = 0

    fc.assert(
      fc.property(arbCreditTransferDocument(), (doc) => {
        runCount++
        const xml = writeCreditTransfer(doc)
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

// ---------------------------------------------------------------------------
// pain.008 hand-written sample test
// ---------------------------------------------------------------------------

describe('pain.008 sample model: write XSD validity and parse round-trip', () => {
  const sampleDirectDebit: DirectDebitDocument = {
    messageId: 'SDD-SAMPLE-001',
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
            amount: euros('0.01'),
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
          {
            endToEndId: 'SDD-E2E-0002',
            amount: euros('49.99'),
            debtor: {
              name: 'Customer Two',
              iban: 'NL91ABNA0417164300',
            },
            mandate: {
              id: 'MAND-0002',
              signatureDate: '2023-11-30',
            },
            remittanceInfo: 'Monthly subscription',
          },
        ],
      },
      {
        id: 'SDD-BATCH-002',
        collectionDate: '2024-07-05',
        sequenceType: 'RCUR',
        localInstrument: 'B2B',
        collections: [
          {
            endToEndId: 'SDD-E2E-0003',
            amount: euros('999.99'),
            debtor: {
              name: 'Business Client',
              iban: 'FR7630006000011234567890189',
              bic: 'BNPAFRPPXXX',
            },
            mandate: {
              id: 'B2B-MAND-001',
              signatureDate: '2022-06-01',
            },
            remittanceInfo: 'Q2 service fee',
          },
        ],
      },
    ],
  }

  it('write produces XSD-valid pain.008 XML', async () => {
    const xml = writeDirectDebit(sampleDirectDebit)
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('write output contains pain.008 namespace', () => {
    const xml = writeDirectDebit(sampleDirectDebit)
    expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pain.008.001.08')
    expect(xml).toContain('CstmrDrctDbtInitn')
  })

  it("parse(write(model)) returns type='pain.008' and deep-equals the original model", () => {
    const xml = writeDirectDebit(sampleDirectDebit)
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    expect(parsed.type).toBe('pain.008')
    if (parsed.type !== 'pain.008') throw new Error('unexpected type')
    expect(parsed.data).toEqual(sampleDirectDebit)
  })

  it('writeDirectDebit generates correct NbOfTxs and CtrlSum', () => {
    const xml = writeDirectDebit(sampleDirectDebit)
    // NbOfTxs = 3 (0.01 + 49.99 + 999.99)
    expect(xml).toContain('<NbOfTxs>3</NbOfTxs>')
    // CtrlSum = 1049.99
    expect(xml).toContain('<CtrlSum>1049.99</CtrlSum>')
  })

  it('CdtrSchmeId is emitted with SEPA scheme name at PmtInf level', () => {
    const xml = writeDirectDebit(sampleDirectDebit)
    expect(xml).toContain('<CdtrSchmeId>')
    expect(xml).toContain('<Prtry>SEPA</Prtry>')
    expect(xml).toContain(`<Id>DE98ZZZ09999999999</Id>`)
  })

  it('ChrgBr=SLEV is emitted at PmtInf level', () => {
    const xml = writeDirectDebit(sampleDirectDebit)
    expect(xml).toContain('<ChrgBr>SLEV</ChrgBr>')
  })
})

// ---------------------------------------------------------------------------
// pain.008 XSD Oracle property test
// ---------------------------------------------------------------------------

describe('XSD Oracle: pain.008.001.08', () => {
  it('property: forAll valid models, writeDirectDebit produces XSD-valid XML (numRuns=200)', async () => {
    const failures: string[] = []
    let runCount = 0

    await fc.assert(
      fc.asyncProperty(arbDirectDebitDocument(), async (doc) => {
        runCount++
        const xml = writeDirectDebit(doc)
        const result = await validateXsd(xml)

        if (!result.valid) {
          failures.push(
            `Run ${runCount}: XSD error: ${result.errors.join(', ')}\nXML:\n${xml.slice(0, 800)}`
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
// pain.008 round-trip property test
// ---------------------------------------------------------------------------

describe('Round-trip: pain.008 model -> write -> parse -> deep-equal (numRuns=200)', () => {
  it('property: forAll valid models, parse(writeDirectDebit(model)) deep-equals original (numRuns=200)', () => {
    let runCount = 0

    fc.assert(
      fc.property(arbDirectDebitDocument(), (doc) => {
        runCount++
        const xml = writeDirectDebit(doc)
        const result = parse(xml)

        if (!result.ok) {
          throw new Error(
            `parse() failed on valid model at run ${runCount}: ${result.error}\nXML:\n${xml.slice(0, 500)}`
          )
        }

        if (result.type !== 'pain.008') {
          throw new Error(`Expected type "pain.008" but got "${result.type}"`)
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

// ---------------------------------------------------------------------------
// Creditor Identifier unit tests
// ---------------------------------------------------------------------------

describe('isValidCreditorId: SEPA Creditor Identifier ISO 7064 MOD 97-10 check digit', () => {
  it('accepts the canonical example DE98ZZZ09999999999', () => {
    expect(isValidCreditorId('DE98ZZZ09999999999')).toBe(true)
  })

  it('rejects DE98ZZZ09999999999 with wrong check digits (DE97...)', () => {
    expect(isValidCreditorId('DE97ZZZ09999999999')).toBe(false)
  })

  it('rejects DE98ZZZ09999999999 with wrong check digits (DE01...)', () => {
    expect(isValidCreditorId('DE01ZZZ09999999999')).toBe(false)
  })

  it('accepts AT result produced by buildCreditorId', () => {
    const built = buildCreditorId('AT', 'ZZZ', '00000000001')
    expect(isValidCreditorId(built)).toBe(true)
  })

  it('accepts NL result produced by buildCreditorId', () => {
    const built = buildCreditorId('NL', 'ZZZ', '000000001')
    expect(isValidCreditorId(built)).toBe(true)
  })

  it('rejects a string that is too short (fewer than 8 chars)', () => {
    expect(isValidCreditorId('DE98ZZZ')).toBe(false)
  })
})

describe('buildCreditorId: computes correct check digits and produces valid output', () => {
  it("buildCreditorId('DE', 'ZZZ', '09999999999') produces DE98ZZZ09999999999", () => {
    expect(buildCreditorId('DE', 'ZZZ', '09999999999')).toBe('DE98ZZZ09999999999')
  })

  it('round-trips: buildCreditorId output always passes isValidCreditorId', () => {
    const cases: Array<[string, string, string]> = [
      ['DE', 'ZZZ', '09999999999'],
      ['FR', 'ZZZ', '12345678'],
      ['NL', 'ABC', '9876543210'],
      ['AT', 'ZZZ', '00000000001'],
      ['BE', 'ZZZ', '695000000008'],
      ['ES', 'ZZZ', '00000001234'],
      ['IT', 'ZZZ', 'ABCDE'],
    ]
    for (const [country, businessCode, nationalId] of cases) {
      const id = buildCreditorId(country, businessCode, nationalId)
      expect(isValidCreditorId(id), `Expected ${id} to be valid`).toBe(true)
    }
  })

  it('produces check digits padded to 2 digits', () => {
    const id = buildCreditorId('BE', 'ZZZ', '695000000008')
    const checkDigits = id.slice(2, 4)
    expect(checkDigits).toHaveLength(2)
    expect(/^\d{2}$/.test(checkDigits)).toBe(true)
  })
})
