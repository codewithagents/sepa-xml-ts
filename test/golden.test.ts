/**
 * Golden-file corpus: real third-party SEPA samples plus canonical snapshots.
 *
 * COVERAGE AND HONEST LIMITATIONS
 * --------------------------------
 * This corpus is a curated handful, not the aspirational 15-20 files.
 * Free, license-clean real samples in our supported namespaces (pain.001.001.09
 * and pain.008.001.08) are scarce: many public bank samples use national DK/CH
 * variants (e.g. pain.001.003.03) or are distributed under LGPL, making them
 * unsafe to vendor. The corpus therefore contains:
 *
 *   Fixture count: 3 vendored third-party files
 *     1. sepa_king.pain.001.001.03.xml  (MIT, salesking/sepa_king)
 *        - pain.001.001.03 coexistence namespace, validates + parses ok
 *     2. pain001.pain.001.001.09.xml    (Apache-2.0, sebastienrousseau/pain001)
 *        - pain.001.001.09, XSD-valid BUT parse ok=false (IBAN/mod-97 error)
 *        - value-demonstration: shows XSD alone is not enough
 *     3. sepa_king.pain.001.003.03.xml  (MIT, salesking/sepa_king)
 *        - pain.001.003.03 national variant, intentionally unsupported namespace
 *        - negative test: confirms graceful rejection
 *
 *   Snapshot count: 2 canonical files (committed, regenerated to catch drift)
 *     1. pain.001.001.09.xml  - multi-batch credit transfer
 *     2. pain.008.001.08.xml  - FRST+RCUR direct debit
 *
 *   Total: 3 real-world fixtures + 2 own canonical snapshots = 5 files
 *
 * To refresh snapshots after an intentional writer change:
 *   UPDATE_SNAPSHOTS=true pnpm test -- test/golden.test.ts
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/parser/parser.js'
import { validateXsd } from '../src/xsd.js'
import { writeCreditTransfer } from '../src/writer/writer.js'
import { writeDirectDebit } from '../src/writer/direct-debit.js'
import { GOLDEN_CREDIT_TRANSFER, GOLDEN_DIRECT_DEBIT } from './golden/generate-snapshots.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const FIXTURES_DIR = join(__dirname, 'golden/fixtures')
const SNAPSHOTS_DIR = join(__dirname, 'golden/snapshots')

/** Read a fixture file. */
function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8')
}

/** Read a snapshot file. */
function readSnapshot(name: string): string {
  return readFileSync(join(SNAPSHOTS_DIR, name), 'utf-8')
}

/**
 * If UPDATE_SNAPSHOTS=true, write the snapshot file and return the content.
 * Otherwise read the existing committed snapshot.
 */
function resolveSnapshot(name: string, generated: string): string {
  if (process.env['UPDATE_SNAPSHOTS'] === 'true') {
    mkdirSync(SNAPSHOTS_DIR, { recursive: true })
    writeFileSync(join(SNAPSHOTS_DIR, name), generated, 'utf-8')
    console.log(`[UPDATE_SNAPSHOTS] wrote ${name}`)
    return generated
  }
  return readSnapshot(name)
}

// ---------------------------------------------------------------------------
// Third-party POSITIVE: sepa_king.pain.001.001.03.xml
// Confirms validateXsd and parse both succeed, plus concrete field assertions.
// ---------------------------------------------------------------------------

describe('third-party fixture: sepa_king.pain.001.001.03.xml (MIT)', () => {
  it('validateXsd returns valid=true', async () => {
    const xml = readFixture('sepa_king.pain.001.001.03.xml')
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('parse returns ok=true with type="pain.001"', () => {
    const xml = readFixture('sepa_king.pain.001.001.03.xml')
    const result = parse(xml)
    expect(result.ok, result.ok ? '' : (result as { error: string }).error).toBe(true)
    if (!result.ok) throw new Error('unexpected parse failure')
    expect(result.type).toBe('pain.001')
  })

  it('messageId matches file content: "Message-ID-4711"', () => {
    const xml = readFixture('sepa_king.pain.001.001.03.xml')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.messageId).toBe('Message-ID-4711')
  })

  it('initiatingParty matches file content: "Initiator Name"', () => {
    const xml = readFixture('sepa_king.pain.001.001.03.xml')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    expect(result.data.initiatingParty).toBe('Initiator Name')
  })

  it('first transfer amount is 654314 minorUnits (6543.14 EUR)', () => {
    const xml = readFixture('sepa_king.pain.001.001.03.xml')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    const tx0 = result.data.batches[0]?.transfers[0]
    expect(tx0?.amount.minorUnits).toBe(654314n)
    expect(tx0?.amount.currencyCode).toBe('EUR')
  })

  it('first transfer creditor IBAN matches file: DE21500500009876543210', () => {
    const xml = readFixture('sepa_king.pain.001.001.03.xml')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    const tx0 = result.data.batches[0]?.transfers[0]
    expect(tx0?.creditor.iban).toBe('DE21500500009876543210')
  })

  it('first transfer endToEndId matches file: "OriginatorID1234"', () => {
    const xml = readFixture('sepa_king.pain.001.001.03.xml')
    const result = parse(xml)
    if (!result.ok || result.type !== 'pain.001') throw new Error('expected ok pain.001')
    const tx0 = result.data.batches[0]?.transfers[0]
    expect(tx0?.endToEndId).toBe('OriginatorID1234')
  })
})

// ---------------------------------------------------------------------------
// Third-party VALUE-DEMONSTRATION: pain001.pain.001.001.09.xml (Apache-2.0)
//
// This file passes the official pain.001.001.09 XSD (validateXsd valid=true)
// but contains at least one IBAN that fails the mod-97 checksum. Our parser
// rejects it with an IBAN validation error. This proves the library provides
// a second layer of protection that the XSD alone cannot offer: the XSD only
// checks structural constraints (element presence, data types, lengths), not
// business-rule invariants like IBAN check digits.
// ---------------------------------------------------------------------------

describe('third-party value-demonstration: pain001.pain.001.001.09.xml (Apache-2.0)', () => {
  it('validateXsd returns valid=true (the file passes the official XSD)', async () => {
    const xml = readFixture('pain001.pain.001.001.09.xml')
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })

  it('parse returns ok=false with an IBAN mod-97 error (XSD alone is not enough)', () => {
    // This is the key assertion: the file passes XSD validation but our model layer
    // catches the invalid IBAN that the schema cannot see. The error message must
    // mention "mod-97" or "IBAN" to confirm the right validation fired.
    const xml = readFixture('pain001.pain.001.001.09.xml')
    const result = parse(xml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok=false')
    // Confirm the rejection is about IBAN checksum, not a structural parse failure
    expect(result.error.toLowerCase()).toMatch(/iban|mod-97|checksum/)
  })
})

// ---------------------------------------------------------------------------
// National-variant NEGATIVE: sepa_king.pain.001.003.03.xml (MIT)
// The pain.001.003.03 namespace is a German national variant we do NOT support.
// Both validateXsd and parse must reject it gracefully.
// ---------------------------------------------------------------------------

describe('national-variant negative: sepa_king.pain.001.003.03.xml (MIT, unsupported namespace)', () => {
  it('validateXsd returns valid=false with an unsupported-namespace error', async () => {
    const xml = readFixture('sepa_king.pain.001.003.03.xml')
    const result = await validateXsd(xml)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/unsupported namespace/i)
  })

  it('parse returns ok=false with an unknown-namespace error', () => {
    const xml = readFixture('sepa_king.pain.001.003.03.xml')
    const result = parse(xml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok=false')
    expect(result.error.toLowerCase()).toMatch(/unknown.*namespace|namespace.*unknown/i)
  })
})

// ---------------------------------------------------------------------------
// Snapshot tests: our own canonical output, committed for regression protection.
//
// These models use fixed, deterministic inputs (no Date.now, no random).
// The writer is re-run on every test run and the output compared to the
// committed snapshot. Any drift in element order, formatting, or field values
// fails immediately.
//
// To refresh after an intentional writer change:
//   UPDATE_SNAPSHOTS=true pnpm test -- test/golden.test.ts
// ---------------------------------------------------------------------------

describe('snapshot: pain.001.001.09 canonical multi-batch credit transfer', () => {
  it('writer output is XSD-valid', async () => {
    const xml = writeCreditTransfer(GOLDEN_CREDIT_TRANSFER)
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })

  it('writer output matches committed snapshot exactly', () => {
    const generated = writeCreditTransfer(GOLDEN_CREDIT_TRANSFER)
    const committed = resolveSnapshot('pain.001.001.09.xml', generated)
    expect(generated).toBe(committed)
  })
})

describe('snapshot: pain.008.001.08 canonical FRST+RCUR direct debit', () => {
  it('writer output is XSD-valid', async () => {
    const xml = writeDirectDebit(GOLDEN_DIRECT_DEBIT)
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })

  it('writer output matches committed snapshot exactly', () => {
    const generated = writeDirectDebit(GOLDEN_DIRECT_DEBIT)
    const committed = resolveSnapshot('pain.008.001.08.xml', generated)
    expect(generated).toBe(committed)
  })
})
