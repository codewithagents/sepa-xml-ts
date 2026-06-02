/**
 * Robustness tests for parse().
 *
 * Verifies that parse() NEVER throws for any input. All failures must be
 * returned as { ok: false, error: string } with a non-empty, meaningful message.
 *
 * Sections:
 * 1. Explicit negative cases (specific error messages)
 * 2. Fast-check fuzz property: arbitrary strings never cause a throw (numRuns >= 300)
 * 3. Fast-check fuzz property: randomly mutated valid XML never causes a throw (numRuns >= 300)
 * 4. Sanity: valid pain.001 and pain.008 XML still parses ok:true
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { parse } from '../src/parser/parser.js'
import { writeCreditTransfer } from '../src/writer/writer.js'
import { writeDirectDebit } from '../src/writer/direct-debit.js'
import { euros } from '../src/model/schema.js'
import type { CreditTransferDocument } from '../src/model/schema.js'
import type { DirectDebitDocument } from '../src/model/pain008.js'

// ---------------------------------------------------------------------------
// Minimal valid fixtures (used for round-trip sanity + mutation base)
// ---------------------------------------------------------------------------

const MINIMAL_PAIN001_DOC: CreditTransferDocument = {
  messageId: 'ROBUST-CT-001',
  createdAt: '2024-06-01T09:00:00Z',
  initiatingParty: 'Test Initiator',
  batches: [
    {
      id: 'BATCH-001',
      executionDate: '2024-06-05',
      debtor: {
        name: 'Test Debtor',
        iban: 'DE89370400440532013000',
        bic: 'COBADEFFXXX',
      },
      transfers: [
        {
          endToEndId: 'E2E-0001',
          amount: euros('1.00'),
          creditor: {
            name: 'Test Creditor',
            iban: 'DE65200400300234567000',
          },
        },
      ],
    },
  ],
}

const MINIMAL_PAIN008_DOC: DirectDebitDocument = {
  messageId: 'ROBUST-DD-001',
  createdAt: '2024-06-01T09:00:00Z',
  initiatingParty: 'Test Initiator',
  creditor: {
    name: 'Test Creditor',
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
          amount: euros('1.00'),
          debtor: {
            name: 'Test Debtor',
            iban: 'DE65200400300234567000',
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
// Helper to build a minimal pain.001 XML string from raw parts (for negative tests)
// ---------------------------------------------------------------------------

const NS_PAIN001 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09'
const NS_PAIN008 = 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.08'
const NS_UNKNOWN = 'urn:example:unknown:namespace'

function minimalPain001Xml(overrides?: {
  ns?: string | null
  body?: string
  missingGrpHdr?: boolean
}): string {
  const ns = overrides?.ns === undefined ? NS_PAIN001 : overrides.ns
  const nsAttr = ns !== null ? ` xmlns="${ns}"` : ''

  if (overrides?.body !== undefined) {
    return `<?xml version="1.0" encoding="UTF-8"?><Document${nsAttr}>${overrides.body}</Document>`
  }

  if (overrides?.missingGrpHdr) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Document${nsAttr}>
  <CstmrCdtTrfInitn>
    <PmtInf>
      <PmtInfId>BATCH-001</PmtInfId>
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`
  }

  return writeCreditTransfer(MINIMAL_PAIN001_DOC)
}

// ---------------------------------------------------------------------------
// 1. Explicit negative test cases
// ---------------------------------------------------------------------------

describe('parse() explicit negative cases: must return ok:false, never throw', () => {
  it('empty string returns ok:false with non-empty error', () => {
    const result = parse('')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toBeTruthy()
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('whitespace-only string returns ok:false with non-empty error', () => {
    const result = parse('   \t\n  ')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toBeTruthy()
    expect(result.error).toMatch(/empty|whitespace/i)
  })

  it('non-XML text returns ok:false with non-empty error', () => {
    const result = parse('this is just plain text, not XML')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('truncated XML (cut mid-tag) returns ok:false with non-empty error', () => {
    const result = parse('<CstmrCdtTrfInitn xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('valid XML but wrong root element returns ok:false', () => {
    const result = parse(`<?xml version="1.0"?><root xmlns="${NS_PAIN001}"><child/></root>`)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('valid XML with no xmlns returns ok:false with missing namespace message', () => {
    const result = parse(
      `<?xml version="1.0"?><Document><CstmrCdtTrfInitn></CstmrCdtTrfInitn></Document>`
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toMatch(/xmlns|namespace/i)
  })

  it('XML with unknown namespace returns ok:false with unknown namespace message', () => {
    const result = parse(
      `<?xml version="1.0"?><Document xmlns="${NS_UNKNOWN}"><SomeEl/></Document>`
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toMatch(/unknown|namespace/i)
  })

  it('pain.001 document missing GrpHdr returns ok:false', () => {
    const result = parse(minimalPain001Xml({ missingGrpHdr: true }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toMatch(/GrpHdr/i)
  })

  it('pain.001 document missing PmtInf returns ok:false', () => {
    const xml = minimalPain001Xml({
      body: `<CstmrCdtTrfInitn>
        <GrpHdr>
          <MsgId>MSG-001</MsgId>
          <CreDtTm>2024-06-01T09:00:00Z</CreDtTm>
          <NbOfTxs>1</NbOfTxs>
          <InitgPty><Nm>Test Initiator</Nm></InitgPty>
        </GrpHdr>
      </CstmrCdtTrfInitn>`,
    })
    const result = parse(xml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toMatch(/PmtInf/i)
  })

  it('transaction with non-numeric amount returns ok:false', () => {
    // Build a valid XML then replace the amount with a non-numeric value
    const validXml = writeCreditTransfer(MINIMAL_PAIN001_DOC)
    const malformedXml = validXml.replace(
      /<InstdAmt Ccy="EUR">[\d.]+<\/InstdAmt>/,
      '<InstdAmt Ccy="EUR">NOT_A_NUMBER</InstdAmt>'
    )
    const result = parse(malformedXml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('transaction with non-EUR currency returns ok:false', () => {
    const validXml = writeCreditTransfer(MINIMAL_PAIN001_DOC)
    const malformedXml = validXml.replace(
      /<InstdAmt Ccy="EUR">[\d.]+<\/InstdAmt>/,
      '<InstdAmt Ccy="USD">1.00</InstdAmt>'
    )
    const result = parse(malformedXml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('transaction with malformed IBAN returns ok:false (caught by model validation)', () => {
    const validXml = writeCreditTransfer(MINIMAL_PAIN001_DOC)
    const malformedXml = validXml.replace(
      /<IBAN>DE65200400300234567000<\/IBAN>/,
      '<IBAN>DE00INVALID999</IBAN>'
    )
    const result = parse(malformedXml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('CdtTrfTxInf with no Amt element returns ok:false', () => {
    const validXml = writeCreditTransfer(MINIMAL_PAIN001_DOC)
    // Remove the entire <Amt>...</Amt> block
    const malformedXml = validXml.replace(/<Amt>[\s\S]*?<\/Amt>/, '')
    const result = parse(malformedXml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('pain.008 document with missing CstmrDrctDbtInitn returns ok:false', () => {
    const xml = `<?xml version="1.0"?><Document xmlns="${NS_PAIN008}"><SomethingElse/></Document>`
    const result = parse(xml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toMatch(/CstmrDrctDbtInitn/i)
  })

  it('non-string input (number) returns ok:false via runtime guard', () => {
    // Cast to any to bypass TypeScript type checking and test runtime guard
    const result = parse(42 as any)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toMatch(/string/i)
  })

  it('non-string input (null) returns ok:false via runtime guard', () => {
    const result = parse(null as any)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toMatch(/string/i)
  })
})

// ---------------------------------------------------------------------------
// 2. Fuzz property: arbitrary random strings never cause parse() to throw
// ---------------------------------------------------------------------------

describe('parse() fuzz: arbitrary random strings never throw (numRuns >= 300)', () => {
  it('property: parse(arbitraryString) never throws, always returns ParseResult', () => {
    let runCount = 0

    fc.assert(
      fc.property(fc.string(), (input) => {
        runCount++
        // The key property: must not throw
        expect(() => parse(input)).not.toThrow()
        // The result must have an ok field
        const result = parse(input)
        expect(typeof result.ok).toBe('boolean')
        // If ok:false, must have a non-empty error message
        if (!result.ok) {
          expect(result.error.length).toBeGreaterThan(0)
        }
        return true
      }),
      {
        numRuns: 300,
        verbose: false,
      }
    )

    expect(runCount).toBeGreaterThanOrEqual(300)
  })

  it('property: parse(arbitraryUnicodeString) never throws (numRuns=300)', () => {
    let runCount = 0

    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (input) => {
        runCount++
        expect(() => parse(input)).not.toThrow()
        const result = parse(input)
        expect(typeof result.ok).toBe('boolean')
        return true
      }),
      {
        numRuns: 300,
        verbose: false,
      }
    )

    expect(runCount).toBeGreaterThanOrEqual(300)
  })
})

// ---------------------------------------------------------------------------
// 3. Fuzz property: single-character mutations of valid XML never cause a throw
// ---------------------------------------------------------------------------

describe('parse() fuzz: mutated valid XML never throws (numRuns >= 300)', () => {
  it('property: randomly deleting one character from valid pain.001 XML never throws', () => {
    const validXml = writeCreditTransfer(MINIMAL_PAIN001_DOC)
    let runCount = 0

    fc.assert(
      fc.property(fc.integer({ min: 0, max: validXml.length - 1 }), (deletePos) => {
        runCount++
        const mutated = validXml.slice(0, deletePos) + validXml.slice(deletePos + 1)
        expect(() => parse(mutated)).not.toThrow()
        const result = parse(mutated)
        expect(typeof result.ok).toBe('boolean')
        return true
      }),
      {
        numRuns: 300,
        verbose: false,
      }
    )

    expect(runCount).toBeGreaterThanOrEqual(300)
  })

  it('property: randomly replacing one character in valid pain.001 XML never throws', () => {
    const validXml = writeCreditTransfer(MINIMAL_PAIN001_DOC)
    let runCount = 0

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: validXml.length - 1 }),
        fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 1 }),
        (replacePos, replaceChar) => {
          runCount++
          const mutated =
            validXml.slice(0, replacePos) + replaceChar + validXml.slice(replacePos + 1)
          expect(() => parse(mutated)).not.toThrow()
          const result = parse(mutated)
          expect(typeof result.ok).toBe('boolean')
          return true
        }
      ),
      {
        numRuns: 300,
        verbose: false,
      }
    )

    expect(runCount).toBeGreaterThanOrEqual(300)
  })

  it('property: randomly deleting one character from valid pain.008 XML never throws', () => {
    const validXml = writeDirectDebit(MINIMAL_PAIN008_DOC)
    let runCount = 0

    fc.assert(
      fc.property(fc.integer({ min: 0, max: validXml.length - 1 }), (deletePos) => {
        runCount++
        const mutated = validXml.slice(0, deletePos) + validXml.slice(deletePos + 1)
        expect(() => parse(mutated)).not.toThrow()
        const result = parse(mutated)
        expect(typeof result.ok).toBe('boolean')
        return true
      }),
      {
        numRuns: 300,
        verbose: false,
      }
    )

    expect(runCount).toBeGreaterThanOrEqual(300)
  })
})

// ---------------------------------------------------------------------------
// 4. Sanity: valid XML still parses ok:true after parser hardening
// ---------------------------------------------------------------------------

describe('parse() sanity: valid SEPA XML still returns ok:true', () => {
  it('valid pain.001 XML returns ok:true with type=pain.001', () => {
    const xml = writeCreditTransfer(MINIMAL_PAIN001_DOC)
    const result = parse(xml)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true, got: ' + result.error)
    expect(result.type).toBe('pain.001')
  })

  it('valid pain.008 XML returns ok:true with type=pain.008', () => {
    const xml = writeDirectDebit(MINIMAL_PAIN008_DOC)
    const result = parse(xml)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true, got: ' + result.error)
    expect(result.type).toBe('pain.008')
  })

  it('valid pain.001 round-trip deep-equals original', () => {
    const xml = writeCreditTransfer(MINIMAL_PAIN001_DOC)
    const result = parse(xml)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true')
    if (result.type !== 'pain.001') throw new Error('expected type pain.001')
    expect(result.data).toEqual(MINIMAL_PAIN001_DOC)
  })

  it('valid pain.008 round-trip deep-equals original', () => {
    const xml = writeDirectDebit(MINIMAL_PAIN008_DOC)
    const result = parse(xml)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true')
    if (result.type !== 'pain.008') throw new Error('expected type pain.008')
    expect(result.data).toEqual(MINIMAL_PAIN008_DOC)
  })
})
