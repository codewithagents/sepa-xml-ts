/**
 * Explicit positive and negative tests for the pain.008 cross-field SEPA rulebook checks:
 *
 *   R1 (signature before collection): mandate.signatureDate must not be after the batch
 *      collectionDate. Equal dates are allowed.
 *
 *   R2 (OOFF is single-use): a mandate id used in any OOFF batch must appear in exactly one
 *      collection across the whole document, and must not appear under any other sequence type.
 *
 *   R3 (consistent scheme per mandate): a given mandate id must not appear under both CORE and
 *      B2B local instruments in the same document. localInstrument defaults to CORE when omitted.
 *
 * Each rule is tested:
 *   - via validateDirectDebit (returns ruleIssues)
 *   - via writeDirectDebit (throws)
 *   - positive cases confirm the rule does not fire when constraints are satisfied
 *   - negative cases confirm the rule fires for the exact violation
 */

import { describe, it, expect } from 'vitest'
import { validateDirectDebit } from '../src/model/validate.js'
import { checkDirectDebitRules } from '../src/model/dd-rules.js'
import { writeDirectDebit } from '../src/writer/direct-debit.js'
import { euros } from '../src/model/schema.js'
import type { DirectDebitDocument } from '../src/model/pain008.js'

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const CREDITOR_IBAN = 'DE89370400440532013000'
const DEBTOR_IBAN_1 = 'DE65200400300234567000'
const DEBTOR_IBAN_2 = 'NL91ABNA0417164300'
const CREDITOR_ID = 'DE98ZZZ09999999999'

/** Build a minimal valid DirectDebitDocument with one batch and one collection. */
function makeDoc(overrides?: Partial<DirectDebitDocument>): DirectDebitDocument {
  const base: DirectDebitDocument = {
    messageId: 'SEQ-RULES-001',
    createdAt: '2024-06-01T09:00:00Z',
    initiatingParty: 'Test GmbH',
    creditor: {
      name: 'Test GmbH',
      iban: CREDITOR_IBAN,
      bic: 'COBADEFFXXX',
      creditorId: CREDITOR_ID,
    },
    batches: [
      {
        id: 'BATCH-001',
        collectionDate: '2024-07-10',
        sequenceType: 'FRST',
        localInstrument: 'CORE',
        collections: [
          {
            endToEndId: 'E2E-0001',
            amount: euros('10.00'),
            debtor: { name: 'Debtor One', iban: DEBTOR_IBAN_1 },
            mandate: { id: 'MAND-001', signatureDate: '2024-01-15' },
          },
        ],
      },
    ],
    ...overrides,
  }
  return base
}

// ---------------------------------------------------------------------------
// R1: signature before collection
// ---------------------------------------------------------------------------

describe('R1: mandate signatureDate must not be after collectionDate', () => {
  // Positive cases

  it('passes R1 when signatureDate is well before collectionDate', () => {
    const doc = makeDoc()
    const issues = checkDirectDebitRules(doc)
    expect(issues).toHaveLength(0)
  })

  it('passes R1 when signatureDate equals collectionDate (equal dates allowed)', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-001',
          collectionDate: '2024-07-10',
          sequenceType: 'FRST',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-0001',
              amount: euros('10.00'),
              debtor: { name: 'Debtor One', iban: DEBTOR_IBAN_1 },
              // signatureDate === collectionDate: should pass R1
              mandate: { id: 'MAND-001', signatureDate: '2024-07-10' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    expect(issues).toHaveLength(0)
  })

  it('passes R1 for a CORE batch', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-001',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-CORE',
              amount: euros('25.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'CORE-MAND-001', signatureDate: '2024-03-01' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    expect(issues).toHaveLength(0)
  })

  it('passes R1 for a B2B batch', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-001',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'B2B',
          collections: [
            {
              endToEndId: 'E2E-B2B',
              amount: euros('500.00'),
              debtor: { name: 'Business Debtor', iban: DEBTOR_IBAN_2 },
              mandate: { id: 'B2B-MAND-001', signatureDate: '2024-02-28' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    expect(issues).toHaveLength(0)
  })

  // Negative cases

  it('fails R1 when signatureDate is one day after collectionDate', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-001',
          collectionDate: '2024-07-10',
          sequenceType: 'FRST',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-0001',
              amount: euros('10.00'),
              debtor: { name: 'Debtor One', iban: DEBTOR_IBAN_1 },
              // signatureDate 2024-07-11 > collectionDate 2024-07-10: R1 violation
              mandate: { id: 'MAND-001', signatureDate: '2024-07-11' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.path).toBe('batches.0.collections.0.mandate.signatureDate')
    expect(issues[0]?.message).toMatch(/R1/)
    expect(issues[0]?.message).toContain('2024-07-11')
    expect(issues[0]?.message).toContain('2024-07-10')
  })

  it('fails R1 when signatureDate is months after collectionDate', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-001',
          collectionDate: '2024-01-15',
          sequenceType: 'FRST',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-0001',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'MAND-001', signatureDate: '2024-06-01' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toMatch(/R1/)
  })

  it('fails R1 in a B2B batch when signatureDate is after collectionDate', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-B2B',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'B2B',
          collections: [
            {
              endToEndId: 'E2E-B2B',
              amount: euros('200.00'),
              debtor: { name: 'Business', iban: DEBTOR_IBAN_2 },
              // signatureDate > collectionDate in a B2B batch
              mandate: { id: 'B2B-MAND-LATE', signatureDate: '2024-07-11' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toMatch(/R1/)
  })

  it('validateDirectDebit returns ruleIssues when R1 is violated', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-001',
          collectionDate: '2024-07-10',
          sequenceType: 'FRST',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-0001',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'MAND-001', signatureDate: '2024-07-11' },
            },
          ],
        },
      ],
    })
    const result = validateDirectDebit(doc)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.ruleIssues).toBeDefined()
    expect(result.ruleIssues!.length).toBeGreaterThan(0)
    expect(result.ruleIssues![0]?.message).toMatch(/R1/)
  })

  it('writeDirectDebit throws when R1 is violated', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-001',
          collectionDate: '2024-07-10',
          sequenceType: 'FRST',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-0001',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'MAND-001', signatureDate: '2024-07-11' },
            },
          ],
        },
      ],
    })
    expect(() => writeDirectDebit(doc)).toThrow(/SEPA rules/)
    expect(() => writeDirectDebit(doc)).toThrow(/R1/)
  })

  it('writeDirectDebit throws on R1 violation for DK variant too', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-001',
          collectionDate: '2024-07-10',
          sequenceType: 'FRST',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-0001',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'MAND-001', signatureDate: '2025-01-01' },
            },
          ],
        },
      ],
    })
    expect(() => writeDirectDebit(doc, { variant: 'pain.008.003.02' })).toThrow(/SEPA rules/)
    expect(() => writeDirectDebit(doc, { variant: 'pain.008.003.02' })).toThrow(/R1/)
  })
})

// ---------------------------------------------------------------------------
// R2: OOFF is single-use
// ---------------------------------------------------------------------------

describe('R2: OOFF mandate must appear in exactly one collection in the document', () => {
  // Positive cases

  it('passes R2 when an OOFF mandate appears exactly once', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-OOFF',
          collectionDate: '2024-07-10',
          sequenceType: 'OOFF',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-OOFF',
              amount: euros('50.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'OOFF-MAND-001', signatureDate: '2024-01-15' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    expect(issues).toHaveLength(0)
  })

  it('passes R2 when the same mandate id is used with RCUR in two batches (not OOFF)', () => {
    // Same mandate id in two different RCUR batches is valid (recurring collections).
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-RCUR-1',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-R-01',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'RCUR-MAND-001', signatureDate: '2024-01-15' },
            },
          ],
        },
        {
          id: 'BATCH-RCUR-2',
          collectionDate: '2024-08-10',
          sequenceType: 'RCUR',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-R-02',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'RCUR-MAND-001', signatureDate: '2024-01-15' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    expect(issues).toHaveLength(0)
  })

  it('passes R2 when an OOFF batch has multiple collections each with unique mandate ids', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-OOFF',
          collectionDate: '2024-07-10',
          sequenceType: 'OOFF',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-OOFF-1',
              amount: euros('50.00'),
              debtor: { name: 'Debtor One', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'OOFF-MAND-A', signatureDate: '2024-01-15' },
            },
            {
              endToEndId: 'E2E-OOFF-2',
              amount: euros('75.00'),
              debtor: { name: 'Debtor Two', iban: DEBTOR_IBAN_2 },
              mandate: { id: 'OOFF-MAND-B', signatureDate: '2024-02-20' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    expect(issues).toHaveLength(0)
  })

  // Negative cases

  it('fails R2 when an OOFF mandate appears in two collections in the same batch', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-OOFF',
          collectionDate: '2024-07-10',
          sequenceType: 'OOFF',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-OOFF-1',
              amount: euros('50.00'),
              debtor: { name: 'Debtor One', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'SHARED-MAND', signatureDate: '2024-01-15' },
            },
            {
              endToEndId: 'E2E-OOFF-2',
              amount: euros('75.00'),
              debtor: { name: 'Debtor Two', iban: DEBTOR_IBAN_2 },
              // Same mandate id used twice in OOFF: R2 violation
              mandate: { id: 'SHARED-MAND', signatureDate: '2024-02-20' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    // At least one R2 issue must be reported
    const r2Issues = issues.filter((i) => i.message.includes('R2'))
    expect(r2Issues.length).toBeGreaterThan(0)
    expect(r2Issues[0]?.message).toContain('SHARED-MAND')
    expect(r2Issues[0]?.message).toMatch(/OOFF/)
  })

  it('fails R2 when an OOFF mandate also appears in a non-OOFF batch', () => {
    // OOFF mandate must be used exactly once in the document.
    // If it also appears in a RCUR batch, R2 is violated.
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-OOFF',
          collectionDate: '2024-07-10',
          sequenceType: 'OOFF',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-OOFF',
              amount: euros('50.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'MAND-ALSO-RCUR', signatureDate: '2024-01-15' },
            },
          ],
        },
        {
          id: 'BATCH-RCUR',
          collectionDate: '2024-08-10',
          sequenceType: 'RCUR',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-RCUR',
              amount: euros('50.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              // Same mandate id reused in a RCUR batch: R2 violation
              mandate: { id: 'MAND-ALSO-RCUR', signatureDate: '2024-01-15' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    const r2Issues = issues.filter((i) => i.message.includes('R2'))
    expect(r2Issues.length).toBeGreaterThan(0)
    expect(r2Issues[0]?.message).toContain('MAND-ALSO-RCUR')
  })

  it('validateDirectDebit returns ruleIssues when R2 is violated', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-OOFF',
          collectionDate: '2024-07-10',
          sequenceType: 'OOFF',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-1',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'OOFF-DUP', signatureDate: '2024-01-15' },
            },
            {
              endToEndId: 'E2E-2',
              amount: euros('20.00'),
              debtor: { name: 'Debtor Two', iban: DEBTOR_IBAN_2 },
              mandate: { id: 'OOFF-DUP', signatureDate: '2024-02-01' },
            },
          ],
        },
      ],
    })
    const result = validateDirectDebit(doc)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.ruleIssues).toBeDefined()
    const r2 = result.ruleIssues!.filter((i) => i.message.includes('R2'))
    expect(r2.length).toBeGreaterThan(0)
  })

  it('writeDirectDebit throws when R2 is violated', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-OOFF',
          collectionDate: '2024-07-10',
          sequenceType: 'OOFF',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-1',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'OOFF-DUP', signatureDate: '2024-01-15' },
            },
            {
              endToEndId: 'E2E-2',
              amount: euros('20.00'),
              debtor: { name: 'Debtor Two', iban: DEBTOR_IBAN_2 },
              mandate: { id: 'OOFF-DUP', signatureDate: '2024-02-01' },
            },
          ],
        },
      ],
    })
    expect(() => writeDirectDebit(doc)).toThrow(/SEPA rules/)
    expect(() => writeDirectDebit(doc)).toThrow(/R2/)
  })
})

// ---------------------------------------------------------------------------
// R3: consistent scheme per mandate
// ---------------------------------------------------------------------------

describe('R3: a mandate id must not be used under both CORE and B2B in the same document', () => {
  // Positive cases

  it('passes R3 when the same mandate id is used under CORE in two batches', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-CORE-1',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-C1',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'CORE-RECURRING', signatureDate: '2024-01-15' },
            },
          ],
        },
        {
          id: 'BATCH-CORE-2',
          collectionDate: '2024-08-10',
          sequenceType: 'RCUR',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-C2',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'CORE-RECURRING', signatureDate: '2024-01-15' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    expect(issues).toHaveLength(0)
  })

  it('passes R3 when the same mandate id is used under B2B in two batches', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-B2B-1',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'B2B',
          collections: [
            {
              endToEndId: 'E2E-B1',
              amount: euros('100.00'),
              debtor: { name: 'Business Debtor', iban: DEBTOR_IBAN_2 },
              mandate: { id: 'B2B-RECURRING', signatureDate: '2024-01-15' },
            },
          ],
        },
        {
          id: 'BATCH-B2B-2',
          collectionDate: '2024-08-10',
          sequenceType: 'RCUR',
          localInstrument: 'B2B',
          collections: [
            {
              endToEndId: 'E2E-B2',
              amount: euros('100.00'),
              debtor: { name: 'Business Debtor', iban: DEBTOR_IBAN_2 },
              mandate: { id: 'B2B-RECURRING', signatureDate: '2024-01-15' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    expect(issues).toHaveLength(0)
  })

  it('passes R3 when a CORE mandate and a separate B2B mandate have different ids', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-CORE',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-CORE',
              amount: euros('10.00'),
              debtor: { name: 'Debtor One', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'CORE-MAND-001', signatureDate: '2024-01-15' },
            },
          ],
        },
        {
          id: 'BATCH-B2B',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'B2B',
          collections: [
            {
              endToEndId: 'E2E-B2B',
              amount: euros('500.00'),
              debtor: { name: 'Debtor Two', iban: DEBTOR_IBAN_2 },
              // Different mandate id: no R3 violation
              mandate: { id: 'B2B-MAND-001', signatureDate: '2024-02-28' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    expect(issues).toHaveLength(0)
  })

  it('passes R3 when localInstrument is omitted (defaults to CORE) and the mandate only appears in CORE batches', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-IMPLICIT-CORE',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          // localInstrument omitted: defaults to CORE on write and in rules
          collections: [
            {
              endToEndId: 'E2E-IMPL',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'IMPL-CORE', signatureDate: '2024-01-15' },
            },
          ],
        },
        {
          id: 'BATCH-EXPLICIT-CORE',
          collectionDate: '2024-08-10',
          sequenceType: 'RCUR',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-EXPL',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              // Same id, both resolve to CORE: no violation
              mandate: { id: 'IMPL-CORE', signatureDate: '2024-01-15' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    expect(issues).toHaveLength(0)
  })

  // Negative cases

  it('fails R3 when the same mandate id appears under both CORE and B2B', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-CORE',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-CORE',
              amount: euros('10.00'),
              debtor: { name: 'Debtor One', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'MIXED-MAND', signatureDate: '2024-01-15' },
            },
          ],
        },
        {
          id: 'BATCH-B2B',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'B2B',
          collections: [
            {
              endToEndId: 'E2E-B2B',
              amount: euros('10.00'),
              debtor: { name: 'Debtor One', iban: DEBTOR_IBAN_1 },
              // Same id under B2B: R3 violation
              mandate: { id: 'MIXED-MAND', signatureDate: '2024-01-15' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    const r3Issues = issues.filter((i) => i.message.includes('R3'))
    expect(r3Issues.length).toBeGreaterThan(0)
    expect(r3Issues[0]?.message).toContain('MIXED-MAND')
    expect(r3Issues[0]?.message).toContain('CORE')
    expect(r3Issues[0]?.message).toContain('B2B')
  })

  it('fails R3 when localInstrument is omitted (defaults to CORE) and the same id appears under B2B', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-IMPLICIT-CORE',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          // No localInstrument: defaults to CORE
          collections: [
            {
              endToEndId: 'E2E-IMPL',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'SCHEME-MAND', signatureDate: '2024-01-15' },
            },
          ],
        },
        {
          id: 'BATCH-B2B',
          collectionDate: '2024-08-10',
          sequenceType: 'RCUR',
          localInstrument: 'B2B',
          collections: [
            {
              endToEndId: 'E2E-B2B',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'SCHEME-MAND', signatureDate: '2024-01-15' },
            },
          ],
        },
      ],
    })
    const issues = checkDirectDebitRules(doc)
    const r3Issues = issues.filter((i) => i.message.includes('R3'))
    expect(r3Issues.length).toBeGreaterThan(0)
  })

  it('validateDirectDebit returns ruleIssues when R3 is violated', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-CORE',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-CORE',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'CROSS-SCHEME', signatureDate: '2024-01-15' },
            },
          ],
        },
        {
          id: 'BATCH-B2B',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'B2B',
          collections: [
            {
              endToEndId: 'E2E-B2B',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'CROSS-SCHEME', signatureDate: '2024-01-15' },
            },
          ],
        },
      ],
    })
    const result = validateDirectDebit(doc)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.ruleIssues).toBeDefined()
    const r3 = result.ruleIssues!.filter((i) => i.message.includes('R3'))
    expect(r3.length).toBeGreaterThan(0)
  })

  it('writeDirectDebit throws when R3 is violated', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-CORE',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-CORE',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'CROSS-SCHEME-2', signatureDate: '2024-01-15' },
            },
          ],
        },
        {
          id: 'BATCH-B2B',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'B2B',
          collections: [
            {
              endToEndId: 'E2E-B2B',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'CROSS-SCHEME-2', signatureDate: '2024-01-15' },
            },
          ],
        },
      ],
    })
    expect(() => writeDirectDebit(doc)).toThrow(/SEPA rules/)
    expect(() => writeDirectDebit(doc)).toThrow(/R3/)
  })

  it('writeDirectDebit throws on R3 violation for DK variant too', () => {
    const doc = makeDoc({
      batches: [
        {
          id: 'BATCH-CORE',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-CORE',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'DK-CROSS-SCHEME', signatureDate: '2024-01-15' },
            },
          ],
        },
        {
          id: 'BATCH-B2B',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'B2B',
          collections: [
            {
              endToEndId: 'E2E-B2B',
              amount: euros('10.00'),
              debtor: { name: 'Debtor', iban: DEBTOR_IBAN_1 },
              mandate: { id: 'DK-CROSS-SCHEME', signatureDate: '2024-01-15' },
            },
          ],
        },
      ],
    })
    expect(() => writeDirectDebit(doc, { variant: 'pain.008.003.02' })).toThrow(/SEPA rules/)
    expect(() => writeDirectDebit(doc, { variant: 'pain.008.003.02' })).toThrow(/R3/)
  })
})

// ---------------------------------------------------------------------------
// Combined: documents that pass all rules
// ---------------------------------------------------------------------------

describe('All rules pass for a well-formed document', () => {
  it('passes R1+R2+R3 for a multi-batch document with FRST, RCUR, and OOFF', () => {
    const doc: DirectDebitDocument = {
      messageId: 'MULTI-BATCH-001',
      createdAt: '2024-06-01T09:00:00Z',
      initiatingParty: 'Test GmbH',
      creditor: {
        name: 'Test GmbH',
        iban: CREDITOR_IBAN,
        bic: 'COBADEFFXXX',
        creditorId: CREDITOR_ID,
      },
      batches: [
        {
          id: 'FRST-BATCH',
          collectionDate: '2024-07-10',
          sequenceType: 'FRST',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-F01',
              amount: euros('10.00'),
              debtor: { name: 'Debtor A', iban: DEBTOR_IBAN_1 },
              // signatureDate well before collectionDate
              mandate: { id: 'FRST-MAND-A', signatureDate: '2024-01-15' },
            },
            {
              endToEndId: 'E2E-F02',
              amount: euros('20.00'),
              debtor: { name: 'Debtor B', iban: DEBTOR_IBAN_2 },
              mandate: { id: 'FRST-MAND-B', signatureDate: '2024-03-01' },
            },
          ],
        },
        {
          id: 'OOFF-BATCH',
          collectionDate: '2024-07-10',
          sequenceType: 'OOFF',
          localInstrument: 'CORE',
          collections: [
            {
              endToEndId: 'E2E-OOFF',
              amount: euros('99.99'),
              debtor: { name: 'Debtor C', iban: DEBTOR_IBAN_1 },
              // Unique mandate id, appears exactly once
              mandate: { id: 'OOFF-MAND-UNIQUE', signatureDate: '2024-07-10' },
            },
          ],
        },
        {
          id: 'B2B-BATCH',
          collectionDate: '2024-07-10',
          sequenceType: 'RCUR',
          localInstrument: 'B2B',
          collections: [
            {
              endToEndId: 'E2E-B2B',
              amount: euros('500.00'),
              debtor: { name: 'Business Debtor', iban: DEBTOR_IBAN_2 },
              // Different id from any CORE mandate: no R3 violation
              mandate: { id: 'B2B-MAND-UNIQUE', signatureDate: '2022-11-01' },
            },
          ],
        },
      ],
    }
    const issues = checkDirectDebitRules(doc)
    expect(issues).toHaveLength(0)

    const result = validateDirectDebit(doc)
    expect(result.ok).toBe(true)
  })

  it('writeDirectDebit succeeds for a well-formed multi-batch document', () => {
    const doc = makeDoc()
    expect(() => writeDirectDebit(doc)).not.toThrow()
    const xml = writeDirectDebit(doc)
    expect(xml).toContain('CstmrDrctDbtInitn')
  })
})
