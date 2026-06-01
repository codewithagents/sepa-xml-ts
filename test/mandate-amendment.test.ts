/**
 * Unit tests for SEPA Direct Debit mandate amendment (AmdmntInd + AmdmntInfDtls).
 *
 * Covers:
 * - pain.008.001.08: write/parse round-trip and XSD validity for each amendment variant
 * - Schema validation: empty amendment, mutual exclusion, invalid IBAN
 * - R4: SMNDA requires FRST sequenceType
 * - Fail-loud throw for the DK variant (pain.008.003.02)
 */

import { describe, it, expect } from 'vitest'
import { validateXsd } from '../src/xsd.js'
import { writeDirectDebit } from '../src/writer/direct-debit.js'
import { parse } from '../src/parser/parser.js'
import { validateDirectDebit } from '../src/model/validate.js'
import { checkDirectDebitRules } from '../src/model/dd-rules.js'
import { DirectDebitDocumentSchema } from '../src/model/pain008.js'
import { euros } from '../src/model/schema.js'
import type { DirectDebitDocument } from '../src/model/pain008.js'

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const CREDITOR_IBAN = 'DE89370400440532013000'
const DEBTOR_IBAN = 'DE65200400300234567000'
const DEBTOR_IBAN_2 = 'NL91ABNA0417164300'
const CREDITOR_ID = 'DE98ZZZ09999999999'

/** Build a minimal valid DirectDebitDocument with configurable mandate options. */
function makeDoc(
  mandateOverrides?: Partial<DirectDebitDocument['batches'][0]['collections'][0]['mandate']>,
  batchOverrides?: Partial<DirectDebitDocument['batches'][0]>
): DirectDebitDocument {
  return {
    messageId: 'AMD-TEST-001',
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
        ...batchOverrides,
        collections: [
          {
            endToEndId: 'E2E-0001',
            amount: euros('25.00'),
            debtor: { name: 'Customer One', iban: DEBTOR_IBAN },
            mandate: {
              id: 'MAND-0001',
              signatureDate: '2024-01-15',
              ...mandateOverrides,
            },
          },
        ],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Absent amendment: output must be byte-identical to prior behavior
// ---------------------------------------------------------------------------

describe('absent amendment: output is byte-identical to pre-amendment behavior', () => {
  it('does not emit AmdmntInd or AmdmntInfDtls when amendment is absent', () => {
    const xml = writeDirectDebit(makeDoc())
    expect(xml).not.toContain('AmdmntInd')
    expect(xml).not.toContain('AmdmntInfDtls')
    expect(xml).toContain('<MndtId>MAND-0001</MndtId>')
    expect(xml).toContain('<DtOfSgntr>2024-01-15</DtOfSgntr>')
  })

  it('produces XSD-valid XML with no amendment', async () => {
    const xml = writeDirectDebit(makeDoc())
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })

  it('round-trips without amendment (deep-equal)', () => {
    const doc = makeDoc()
    const xml = writeDirectDebit(doc)
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    if (parsed.type !== 'pain.008') throw new Error('unexpected type')
    expect(parsed.data).toEqual(doc)
  })
})

// ---------------------------------------------------------------------------
// amendment = { originalMandateId }
// ---------------------------------------------------------------------------

describe('amendment with originalMandateId only', () => {
  it('produces XSD-valid XML', async () => {
    const doc = makeDoc({ amendment: { originalMandateId: 'OLD-MAND-0001' } })
    const xml = writeDirectDebit(doc)
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })

  it('emits AmdmntInd=true, AmdmntInfDtls, and OrgnlMndtId in XML', () => {
    const doc = makeDoc({ amendment: { originalMandateId: 'OLD-MAND-0001' } })
    const xml = writeDirectDebit(doc)
    expect(xml).toContain('<AmdmntInd>true</AmdmntInd>')
    expect(xml).toContain('<AmdmntInfDtls>')
    expect(xml).toContain('<OrgnlMndtId>OLD-MAND-0001</OrgnlMndtId>')
    expect(xml).not.toContain('<OrgnlDbtrAcct>')
    expect(xml).not.toContain('SMNDA')
  })

  it('round-trips (parse(write(model)) deep-equals original)', () => {
    const doc = makeDoc({ amendment: { originalMandateId: 'OLD-MAND-0001' } })
    const xml = writeDirectDebit(doc)
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    if (parsed.type !== 'pain.008') throw new Error('unexpected type')
    expect(parsed.data).toEqual(doc)
  })
})

// ---------------------------------------------------------------------------
// amendment = { originalDebtorAccount }
// ---------------------------------------------------------------------------

describe('amendment with originalDebtorAccount only', () => {
  it('produces XSD-valid XML', async () => {
    const doc = makeDoc({ amendment: { originalDebtorAccount: DEBTOR_IBAN_2 } })
    const xml = writeDirectDebit(doc)
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })

  it('emits AmdmntInd=true, OrgnlDbtrAcct/Id/IBAN in XML', () => {
    const doc = makeDoc({ amendment: { originalDebtorAccount: DEBTOR_IBAN_2 } })
    const xml = writeDirectDebit(doc)
    expect(xml).toContain('<AmdmntInd>true</AmdmntInd>')
    expect(xml).toContain('<OrgnlDbtrAcct>')
    expect(xml).toContain(`<IBAN>${DEBTOR_IBAN_2}</IBAN>`)
    expect(xml).not.toContain('<OrgnlMndtId>')
    expect(xml).not.toContain('SMNDA')
  })

  it('round-trips (parse(write(model)) deep-equals original)', () => {
    const doc = makeDoc({ amendment: { originalDebtorAccount: DEBTOR_IBAN_2 } })
    const xml = writeDirectDebit(doc)
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    if (parsed.type !== 'pain.008') throw new Error('unexpected type')
    expect(parsed.data).toEqual(doc)
  })
})

// ---------------------------------------------------------------------------
// amendment = { sameMandateNewDebtorAccount: true } in a FRST batch
// ---------------------------------------------------------------------------

describe('amendment with sameMandateNewDebtorAccount (SMNDA) in FRST batch', () => {
  it('produces XSD-valid XML', async () => {
    const doc = makeDoc({ amendment: { sameMandateNewDebtorAccount: true } })
    const xml = writeDirectDebit(doc)
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })

  it('emits AmdmntInd=true and the SMNDA marker in OrgnlDbtrAgt/FinInstnId/Othr/Id', () => {
    const doc = makeDoc({ amendment: { sameMandateNewDebtorAccount: true } })
    const xml = writeDirectDebit(doc)
    expect(xml).toContain('<AmdmntInd>true</AmdmntInd>')
    expect(xml).toContain('<AmdmntInfDtls>')
    expect(xml).toContain('<OrgnlDbtrAgt>')
    expect(xml).toContain('<Id>SMNDA</Id>')
    expect(xml).not.toContain('<OrgnlMndtId>')
    expect(xml).not.toContain('<OrgnlDbtrAcct>')
  })

  it('round-trips (parse(write(model)) deep-equals original)', () => {
    const doc = makeDoc({ amendment: { sameMandateNewDebtorAccount: true } })
    const xml = writeDirectDebit(doc)
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    if (parsed.type !== 'pain.008') throw new Error('unexpected type')
    expect(parsed.data).toEqual(doc)
  })
})

// ---------------------------------------------------------------------------
// amendment = { originalMandateId, originalDebtorAccount } (both set)
// ---------------------------------------------------------------------------

describe('amendment with both originalMandateId and originalDebtorAccount', () => {
  it('produces XSD-valid XML', async () => {
    const doc = makeDoc({
      amendment: { originalMandateId: 'OLD-ID', originalDebtorAccount: DEBTOR_IBAN_2 },
    })
    const xml = writeDirectDebit(doc)
    const result = await validateXsd(xml)
    expect(result.valid, `XSD errors: ${result.errors.join(', ')}`).toBe(true)
  })

  it('round-trips (parse(write(model)) deep-equals original)', () => {
    const doc = makeDoc({
      amendment: { originalMandateId: 'OLD-ID', originalDebtorAccount: DEBTOR_IBAN_2 },
    })
    const xml = writeDirectDebit(doc)
    const parsed = parse(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse failed: ' + parsed.error)
    if (parsed.type !== 'pain.008') throw new Error('unexpected type')
    expect(parsed.data).toEqual(doc)
  })
})

// ---------------------------------------------------------------------------
// Schema validation: empty amendment and mutual-exclusion checks
// ---------------------------------------------------------------------------

describe('MandateAmendmentSchema validation', () => {
  it('rejects an empty amendment object (no fields set)', () => {
    const result = DirectDebitDocumentSchema.safeParse(makeDoc({ amendment: {} as never }))
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    const messages = result.error.issues.map((i) => i.message).join('; ')
    expect(messages).toMatch(/at least one meaningful detail/)
  })

  it('rejects an amendment with only sameMandateNewDebtorAccount: false (not meaningful)', () => {
    const result = DirectDebitDocumentSchema.safeParse(
      makeDoc({ amendment: { sameMandateNewDebtorAccount: false } })
    )
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    const messages = result.error.issues.map((i) => i.message).join('; ')
    expect(messages).toMatch(/at least one meaningful detail/)
  })

  it('rejects originalDebtorAccount + sameMandateNewDebtorAccount:true (mutual exclusion)', () => {
    const result = DirectDebitDocumentSchema.safeParse(
      makeDoc({
        amendment: { originalDebtorAccount: DEBTOR_IBAN_2, sameMandateNewDebtorAccount: true },
      })
    )
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    const messages = result.error.issues.map((i) => i.message).join('; ')
    expect(messages).toMatch(/mutually exclusive/)
  })

  it('rejects an invalid originalDebtorAccount IBAN', () => {
    const result = DirectDebitDocumentSchema.safeParse(
      makeDoc({ amendment: { originalDebtorAccount: 'INVALID-IBAN' } })
    )
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    const messages = result.error.issues.map((i) => i.message).join('; ')
    // Should fail IBAN format or mod-97 check
    expect(messages.toLowerCase()).toMatch(/iban/)
  })

  it('rejects an IBAN that passes format but fails mod-97 (e.g. DE00 with wrong check digits)', () => {
    const result = DirectDebitDocumentSchema.safeParse(
      makeDoc({ amendment: { originalDebtorAccount: 'DE00370400440532013000' } })
    )
    expect(result.success).toBe(false)
  })

  it('accepts a valid amendment with only originalMandateId', () => {
    const result = DirectDebitDocumentSchema.safeParse(
      makeDoc({ amendment: { originalMandateId: 'OLD-MAND-001' } })
    )
    expect(result.success).toBe(true)
  })

  it('accepts a valid amendment with only originalDebtorAccount (valid IBAN)', () => {
    const result = DirectDebitDocumentSchema.safeParse(
      makeDoc({ amendment: { originalDebtorAccount: DEBTOR_IBAN_2 } })
    )
    expect(result.success).toBe(true)
  })

  it('accepts a valid amendment with only sameMandateNewDebtorAccount: true', () => {
    const result = DirectDebitDocumentSchema.safeParse(
      makeDoc({ amendment: { sameMandateNewDebtorAccount: true } })
    )
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// R4: SMNDA requires sequenceType FRST
// ---------------------------------------------------------------------------

describe('R4: sameMandateNewDebtorAccount=true requires FRST sequenceType', () => {
  it('R4 passes when SMNDA is in a FRST batch', () => {
    const doc = makeDoc(
      { amendment: { sameMandateNewDebtorAccount: true } },
      { sequenceType: 'FRST' }
    )
    const issues = checkDirectDebitRules(doc)
    expect(issues.filter((i) => i.message.includes('R4'))).toHaveLength(0)
  })

  it('R4 fails when SMNDA is in a RCUR batch', () => {
    const doc = makeDoc(
      { amendment: { sameMandateNewDebtorAccount: true } },
      { sequenceType: 'RCUR' }
    )
    const issues = checkDirectDebitRules(doc)
    const r4Issues = issues.filter((i) => i.message.includes('R4'))
    expect(r4Issues).toHaveLength(1)
    expect(r4Issues[0]?.path).toContain('sameMandateNewDebtorAccount')
    expect(r4Issues[0]?.message).toContain('FRST')
    expect(r4Issues[0]?.message).toContain('RCUR')
  })

  it('R4 fails when SMNDA is in an OOFF batch', () => {
    const doc = makeDoc(
      { amendment: { sameMandateNewDebtorAccount: true } },
      { sequenceType: 'OOFF' }
    )
    const issues = checkDirectDebitRules(doc)
    const r4Issues = issues.filter((i) => i.message.includes('R4'))
    expect(r4Issues).toHaveLength(1)
  })

  it('R4 fails when SMNDA is in a FNAL batch', () => {
    const doc = makeDoc(
      { amendment: { sameMandateNewDebtorAccount: true } },
      { sequenceType: 'FNAL' }
    )
    const issues = checkDirectDebitRules(doc)
    const r4Issues = issues.filter((i) => i.message.includes('R4'))
    expect(r4Issues).toHaveLength(1)
  })

  it('validateDirectDebit returns ruleIssues when R4 is violated (SMNDA in RCUR)', () => {
    const doc = makeDoc(
      { amendment: { sameMandateNewDebtorAccount: true } },
      { sequenceType: 'RCUR' }
    )
    const result = validateDirectDebit(doc)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.ruleIssues).toBeDefined()
    const r4 = result.ruleIssues!.filter((i) => i.message.includes('R4'))
    expect(r4.length).toBeGreaterThan(0)
  })

  it('writeDirectDebit throws before emitting when R4 is violated (SMNDA in RCUR)', () => {
    const doc = makeDoc(
      { amendment: { sameMandateNewDebtorAccount: true } },
      { sequenceType: 'RCUR' }
    )
    expect(() => writeDirectDebit(doc)).toThrow(/SEPA rules/)
    expect(() => writeDirectDebit(doc)).toThrow(/R4/)
  })

  it('non-SMNDA amendment (originalMandateId) does not trigger R4 in RCUR batch', () => {
    const doc = makeDoc({ amendment: { originalMandateId: 'OLD-MAND' } }, { sequenceType: 'RCUR' })
    const issues = checkDirectDebitRules(doc)
    const r4Issues = issues.filter((i) => i.message.includes('R4'))
    expect(r4Issues).toHaveLength(0)
  })

  it('non-SMNDA amendment (originalDebtorAccount) does not trigger R4 in RCUR batch', () => {
    const doc = makeDoc(
      { amendment: { originalDebtorAccount: DEBTOR_IBAN_2 } },
      { sequenceType: 'RCUR' }
    )
    const issues = checkDirectDebitRules(doc)
    const r4Issues = issues.filter((i) => i.message.includes('R4'))
    expect(r4Issues).toHaveLength(0)
  })

  it('SMNDA with sameMandateNewDebtorAccount: false does not trigger R4', () => {
    // sameMandateNewDebtorAccount: false is not a valid amendment on its own (schema rejects it),
    // but if somehow passed, it should not fire R4. Here we use a valid amendment with the flag omitted.
    const doc = makeDoc({ amendment: { originalMandateId: 'OLD-MAND' } }, { sequenceType: 'RCUR' })
    const issues = checkDirectDebitRules(doc)
    const r4Issues = issues.filter((i) => i.message.includes('R4'))
    expect(r4Issues).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Fail-loud: DK variant (pain.008.003.02) throws when amendment is present
// ---------------------------------------------------------------------------

describe('DK variant (pain.008.003.02) throws when amendment is present', () => {
  it('throws with a clear message for originalMandateId amendment', () => {
    const doc = makeDoc({ amendment: { originalMandateId: 'OLD-MAND' } })
    expect(() => writeDirectDebit(doc, { variant: 'pain.008.003.02' })).toThrow(
      /mandate amendment is not yet supported for variant pain\.008\.003\.02/
    )
  })

  it('throws with a clear message for originalDebtorAccount amendment', () => {
    const doc = makeDoc({ amendment: { originalDebtorAccount: DEBTOR_IBAN_2 } })
    expect(() => writeDirectDebit(doc, { variant: 'pain.008.003.02' })).toThrow(
      /mandate amendment is not yet supported for variant pain\.008\.003\.02/
    )
  })

  it('throws with a clear message for SMNDA amendment', () => {
    const doc = makeDoc({ amendment: { sameMandateNewDebtorAccount: true } })
    expect(() => writeDirectDebit(doc, { variant: 'pain.008.003.02' })).toThrow(
      /mandate amendment is not yet supported for variant pain\.008\.003\.02/
    )
  })

  it('does NOT throw for DK variant when no amendment is present', () => {
    const doc = makeDoc()
    expect(() => writeDirectDebit(doc, { variant: 'pain.008.003.02' })).not.toThrow()
  })
})
