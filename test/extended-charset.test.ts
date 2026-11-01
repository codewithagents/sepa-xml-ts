/**
 * Opt-in EPC217-08 extended character set (issue #45).
 *
 * Text fields (names, addresses, remittance information) follow the charset option;
 * identifiers, references and codes are basic Latin in every mode (EPC217-08 section
 * 6.3). write and validate default to 'basic', parse defaults to 'extended', and the
 * German DK variants refuse 'extended'.
 *
 * The field-kind table below classifies every string leaf of both document schemas.
 * A schema walker fails the suite when a string field is added without a kind.
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import type { z } from 'zod'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeCreditTransfer } from '../src/writer/writer.js'
import { writeDirectDebit } from '../src/writer/direct-debit.js'
import { parse } from '../src/parser/parser.js'
import { validateXsd } from '../src/xsd.js'
import { validateCreditTransfer, validateDirectDebit } from '../src/model/validate.js'
import { toSepaCharset, SepaCharset } from '../src/model/charset.js'
import { EPC217_08_EXTENDED_ONLY } from '../src/model/epc217-08-table.js'
import { euros, CreditTransferDocumentSchema } from '../src/model/schema.js'
import type { CreditTransferDocument, PostalAddress } from '../src/model/schema.js'
import { DirectDebitDocumentSchema } from '../src/model/pain008.js'
import type { DirectDebitDocument } from '../src/model/pain008.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const DEBTOR_IBAN = 'DE89370400440532013000'
const CREDITOR_IBAN = 'DE65200400300234567000'
const CREDITOR_ID = 'DE98ZZZ09999999999'
const EXTENDED = { charset: 'extended' } as const
const CHARSET_PREFIX = 'Value contains characters outside the SEPA charset (EPC217-08): '
const OPT_IN_HINT = "pass { charset: 'extended' } (SepaCharset.Extended)"
const SECTION_6_3 = 'in every charset mode (EPC217-08 section 6.3)'

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const MINIMAL_DD: DirectDebitDocument = {
  messageId: 'ISSUE45-DD-001',
  createdAt: '2025-01-15T09:00:00Z',
  initiatingParty: 'Initiator',
  creditor: { name: 'Creditor', iban: DEBTOR_IBAN, bic: 'COBADEFFXXX', creditorId: CREDITOR_ID },
  batches: [
    {
      id: 'ISSUE45-BATCH-1',
      collectionDate: '2025-02-05',
      sequenceType: 'FRST',
      localInstrument: 'CORE',
      collections: [
        {
          endToEndId: 'ISSUE45-E2E-1',
          amount: euros('49.99'),
          debtor: { name: 'Debtor', iban: CREDITOR_IBAN },
          mandate: { id: 'MANDATE-0001', signatureDate: '2025-01-10' },
        },
      ],
    },
  ],
}

const MINIMAL_CT: CreditTransferDocument = {
  messageId: 'ISSUE45-CT-001',
  createdAt: '2025-01-15T09:00:00Z',
  initiatingParty: 'Initiator',
  batches: [
    {
      id: 'ISSUE45-BATCH-1',
      executionDate: '2025-01-20',
      debtor: { name: 'Debtor', iban: DEBTOR_IBAN, bic: 'COBADEFFXXX' },
      transfers: [
        {
          endToEndId: 'ISSUE45-E2E-1',
          amount: euros('10.00'),
          creditor: { name: 'Creditor', iban: CREDITOR_IBAN },
          remittanceInfo: 'Invoice 1',
        },
      ],
    },
  ],
}

function withCreditorName(doc: DirectDebitDocument, name: string): DirectDebitDocument {
  return { ...doc, creditor: { ...doc.creditor, name } }
}

function withTransferText(name: string, remittanceInfo: string): CreditTransferDocument {
  const batch = MINIMAL_CT.batches[0]
  const transfer = batch?.transfers[0]
  if (batch === undefined || transfer === undefined) throw new Error('fixture broken')
  return {
    ...MINIMAL_CT,
    batches: [
      {
        ...batch,
        transfers: [{ ...transfer, creditor: { ...transfer.creditor, name }, remittanceInfo }],
      },
    ],
  }
}

const FULL_ADDRESS: PostalAddress = {
  streetName: 'Street',
  buildingNumber: '1',
  postCode: '1000',
  townName: 'Town',
  countrySubDivision: 'Region',
  country: 'SI',
  addressLines: ['Line 1'],
}

const ORG_ID = {
  organisationId: {
    bic: 'COBADEFFXXX',
    lei: '529900T8BM49AURSDO55',
    other: { id: 'ORG-1', schemeName: 'BANK', issuer: 'Issuer' },
  },
}

const PRIVATE_ID = {
  privateId: {
    dateAndPlaceOfBirth: {
      birthDate: '1980-01-01',
      provinceOfBirth: 'Province',
      cityOfBirth: 'City',
      countryOfBirth: 'SI',
    },
    other: { id: 'PRV-1', schemeName: 'NIDN', issuer: 'Issuer' },
  },
}

/** Structured remittance with the Cd branches (A) or the Prtry branches (B). */
function structuredRemittance(branch: 'A' | 'B') {
  return {
    referredDocuments: [
      {
        type: branch === 'A' ? 'CINV' : { proprietary: 'DOCTYPE' },
        number: 'INV-1',
        relatedDate: '2025-01-01',
      },
    ],
    referredDocumentAmount: {
      duePayableAmount: euros('10.00'),
      creditNoteAmount: euros('1.00'),
      remittedAmount: euros('9.00'),
    },
    creditorReference: 'REF-1',
    referenceType: branch === 'A' ? 'SCOR' : { proprietary: 'REFTYPE' },
    issuer: 'Issuer',
  }
}

type Remittance = 'structured' | 'unstructured'

function remittanceFor(branch: 'A' | 'B', remittance: Remittance) {
  return remittance === 'structured'
    ? { structuredRemittance: structuredRemittance(branch) }
    : { remittanceInfo: 'Invoice 1' }
}

/**
 * Documents that together contain every string field of the pain.001 model:
 * branch A takes the Cd path of every Cd-XOR-Prtry choice, branch B the Prtry path;
 * remittance is structured (Strd) or unstructured (Ustrd).
 */
function fullCreditTransfer(
  branch: 'A' | 'B',
  remittanceKind: Remittance = 'structured'
): CreditTransferDocument {
  const code = (cd: string) => (branch === 'A' ? cd : { proprietary: `PRTRY-${cd}` })
  const remittance = remittanceFor(branch, remittanceKind)
  return {
    messageId: 'FULL-CT-1',
    createdAt: '2025-01-15T09:00:00Z',
    initiatingParty: 'Initiator',
    batches: [
      {
        id: 'FULL-BATCH-1',
        executionDate: '2025-01-20',
        debtor: { name: 'Debtor', iban: DEBTOR_IBAN, bic: 'COBADEFFXXX', address: FULL_ADDRESS },
        categoryPurpose: code('SALA'),
        transfers: [
          {
            endToEndId: 'FULL-E2E-1',
            amount: euros('10.00'),
            ultimateDebtor: { name: 'Ultimate Debtor', id: branch === 'A' ? ORG_ID : PRIVATE_ID },
            creditor: {
              name: 'Creditor',
              iban: CREDITOR_IBAN,
              bic: 'DEUTDEDBFRA',
              address: FULL_ADDRESS,
            },
            ultimateCreditor: {
              name: 'Ultimate Creditor',
              id: branch === 'A' ? PRIVATE_ID : ORG_ID,
            },
            purpose: code('SUPP'),
            ...remittance,
          },
        ],
      },
    ],
  } as CreditTransferDocument
}

/** The pain.008 counterpart of fullCreditTransfer. */
function fullDirectDebit(
  branch: 'A' | 'B',
  remittanceKind: Remittance = 'structured'
): DirectDebitDocument {
  const code = (cd: string) => (branch === 'A' ? cd : { proprietary: `PRTRY-${cd}` })
  const remittance = remittanceFor(branch, remittanceKind)
  return {
    messageId: 'FULL-DD-1',
    createdAt: '2025-01-15T09:00:00Z',
    initiatingParty: 'Initiator',
    creditor: {
      name: 'Creditor',
      iban: DEBTOR_IBAN,
      bic: 'COBADEFFXXX',
      address: FULL_ADDRESS,
      creditorId: CREDITOR_ID,
    },
    batches: [
      {
        id: 'FULL-BATCH-1',
        collectionDate: '2025-02-05',
        sequenceType: 'RCUR',
        localInstrument: 'CORE',
        categoryPurpose: code('SALA'),
        collections: [
          {
            endToEndId: 'FULL-E2E-1',
            amount: euros('10.00'),
            ultimateCreditor: {
              name: 'Ultimate Creditor',
              id: branch === 'A' ? ORG_ID : PRIVATE_ID,
            },
            debtor: {
              name: 'Debtor',
              iban: CREDITOR_IBAN,
              bic: 'DEUTDEDBFRA',
              address: FULL_ADDRESS,
            },
            ultimateDebtor: { name: 'Ultimate Debtor', id: branch === 'A' ? PRIVATE_ID : ORG_ID },
            mandate: {
              id: 'MANDATE-0001',
              signatureDate: '2025-01-10',
              amendment: {
                originalMandateId: 'MANDATE-0000',
                originalCreditorSchemeId: { name: 'Old Creditor', creditorId: CREDITOR_ID },
                originalDebtor: { name: 'Old Debtor' },
                originalDebtorAccount: DEBTOR_IBAN,
                originalDebtorAgent: 'COBADEFFXXX',
                originalFinalCollectionDate: '2026-01-01',
                originalFrequency: 'MNTH',
                originalReason: code('MS02'),
              },
            },
            purpose: code('SUPP'),
            ...remittance,
          },
        ],
      },
    ],
  } as DirectDebitDocument
}

// ---------------------------------------------------------------------------
// The field-kind table (mirrors the plan's field_kind_map)
// ---------------------------------------------------------------------------

type FieldKind = 'text' | 'reference' | 'identifier' | 'structured'

const ADDRESS_TEXT = ['streetName', 'buildingNumber', 'postCode', 'townName', 'countrySubDivision']

function addressKinds(prefix: string): Record<string, FieldKind> {
  const kinds: Record<string, FieldKind> = {}
  for (const field of ADDRESS_TEXT) kinds[`${prefix}.address.${field}`] = 'text'
  kinds[`${prefix}.address.addressLines[]`] = 'text'
  kinds[`${prefix}.address.country`] = 'structured'
  return kinds
}

function accountPartyKinds(prefix: string): Record<string, FieldKind> {
  return {
    [`${prefix}.name`]: 'text',
    [`${prefix}.iban`]: 'structured',
    [`${prefix}.bic`]: 'structured',
    ...addressKinds(prefix),
  }
}

function ultimatePartyKinds(prefix: string): Record<string, FieldKind> {
  const org = `${prefix}.id.organisationId`
  const prvt = `${prefix}.id.privateId`
  return {
    [`${prefix}.name`]: 'text',
    [`${org}.bic`]: 'structured',
    [`${org}.lei`]: 'structured',
    [`${org}.other.id`]: 'reference',
    [`${org}.other.schemeName`]: 'reference',
    [`${org}.other.issuer`]: 'reference',
    [`${prvt}.dateAndPlaceOfBirth.birthDate`]: 'structured',
    [`${prvt}.dateAndPlaceOfBirth.provinceOfBirth`]: 'reference',
    [`${prvt}.dateAndPlaceOfBirth.cityOfBirth`]: 'reference',
    [`${prvt}.dateAndPlaceOfBirth.countryOfBirth`]: 'structured',
    [`${prvt}.other.id`]: 'reference',
    [`${prvt}.other.schemeName`]: 'reference',
    [`${prvt}.other.issuer`]: 'reference',
  }
}

function remittanceKinds(prefix: string): Record<string, FieldKind> {
  const strd = `${prefix}.structuredRemittance`
  return {
    [`${prefix}.remittanceInfo`]: 'text',
    [`${strd}.referredDocuments[].type.proprietary`]: 'reference',
    [`${strd}.referredDocuments[].number`]: 'reference',
    [`${strd}.referredDocuments[].relatedDate`]: 'structured',
    [`${strd}.creditorReference`]: 'reference',
    [`${strd}.referenceType.proprietary`]: 'reference',
    [`${strd}.issuer`]: 'reference',
    [`${prefix}.purpose`]: 'reference',
    [`${prefix}.purpose.proprietary`]: 'reference',
  }
}

const CREDIT_TRANSFER_KINDS: Record<string, FieldKind> = {
  messageId: 'identifier',
  createdAt: 'structured',
  initiatingParty: 'text',
  'batches[].id': 'identifier',
  'batches[].executionDate': 'structured',
  'batches[].categoryPurpose': 'reference',
  'batches[].categoryPurpose.proprietary': 'reference',
  ...accountPartyKinds('batches[].debtor'),
  'batches[].transfers[].endToEndId': 'identifier',
  ...accountPartyKinds('batches[].transfers[].creditor'),
  ...ultimatePartyKinds('batches[].transfers[].ultimateDebtor'),
  ...ultimatePartyKinds('batches[].transfers[].ultimateCreditor'),
  ...remittanceKinds('batches[].transfers[]'),
}

const COLLECTION = 'batches[].collections[]'
const AMENDMENT = `${COLLECTION}.mandate.amendment`

const DIRECT_DEBIT_KINDS: Record<string, FieldKind> = {
  messageId: 'identifier',
  createdAt: 'structured',
  initiatingParty: 'text',
  ...accountPartyKinds('creditor'),
  'creditor.creditorId': 'structured',
  'batches[].id': 'identifier',
  'batches[].collectionDate': 'structured',
  'batches[].categoryPurpose': 'reference',
  'batches[].categoryPurpose.proprietary': 'reference',
  [`${COLLECTION}.endToEndId`]: 'identifier',
  ...ultimatePartyKinds(`${COLLECTION}.ultimateCreditor`),
  ...accountPartyKinds(`${COLLECTION}.debtor`),
  ...ultimatePartyKinds(`${COLLECTION}.ultimateDebtor`),
  [`${COLLECTION}.mandate.id`]: 'reference',
  [`${COLLECTION}.mandate.signatureDate`]: 'structured',
  [`${AMENDMENT}.originalMandateId`]: 'reference',
  [`${AMENDMENT}.originalCreditorSchemeId.name`]: 'text',
  [`${AMENDMENT}.originalCreditorSchemeId.creditorId`]: 'structured',
  [`${AMENDMENT}.originalDebtor.name`]: 'text',
  [`${AMENDMENT}.originalDebtorAccount`]: 'structured',
  [`${AMENDMENT}.originalDebtorAgent`]: 'structured',
  [`${AMENDMENT}.originalFinalCollectionDate`]: 'structured',
  [`${AMENDMENT}.originalReason`]: 'reference',
  [`${AMENDMENT}.originalReason.proprietary`]: 'reference',
  ...remittanceKinds(COLLECTION),
}

// ---------------------------------------------------------------------------
// Schema walker and path helpers
// ---------------------------------------------------------------------------

const NON_STRING_LEAVES = new Set(['enum', 'literal', 'bigint', 'boolean'])

/** Every string leaf of a schema, as a path pattern with [] for array elements. */
function stringLeafPaths(schema: z.ZodType, prefix = ''): string[] {
  const def = schema._zod.def as unknown as Record<string, unknown> & { type: string }
  const child = (key: string) => (prefix === '' ? key : `${prefix}.${key}`)
  switch (def.type) {
    case 'string':
      return [prefix]
    case 'optional':
      return stringLeafPaths(def['innerType'] as z.ZodType, prefix)
    case 'array':
      return stringLeafPaths(def['element'] as z.ZodType, `${prefix}[]`)
    case 'union':
      return [
        ...new Set(
          (def['options'] as z.ZodType[]).flatMap((option) => stringLeafPaths(option, prefix))
        ),
      ]
    case 'object':
      return Object.entries(def['shape'] as Record<string, z.ZodType>).flatMap(([key, value]) =>
        stringLeafPaths(value, child(key))
      )
    default:
      if (NON_STRING_LEAVES.has(def.type)) return []
      throw new Error(`schema walker: unhandled Zod type "${def.type}" at ${prefix}`)
  }
}

/** Turn a path pattern into the concrete path of the first element of every array. */
function concretePath(pattern: string): Array<string | number> {
  return pattern
    .split('.')
    .flatMap((segment) => (segment.endsWith('[]') ? [segment.slice(0, -2), 0] : [segment]))
}

/** A deep copy of doc with value at the path, or null when the path is not in doc. */
function withValueAt<T>(doc: T, path: Array<string | number>, value: string): T | null {
  const copy = structuredClone(doc) as unknown
  let parent: unknown = copy
  for (const key of path.slice(0, -1)) {
    if (parent === null || typeof parent !== 'object') return null
    parent = (parent as Record<string | number, unknown>)[key]
  }
  const last = path[path.length - 1]
  if (parent === null || typeof parent !== 'object' || last === undefined) return null
  const record = parent as Record<string | number, unknown>
  if (typeof record[last] !== 'string') return null
  record[last] = value
  return copy as T
}

type Validator = (
  input: unknown,
  charset: SepaCharset
) => { ok: boolean; issues: z.core.$ZodIssue[] }

const validateCt: Validator = (input, charset) => {
  const result = validateCreditTransfer(input, { charset })
  return { ok: result.ok, issues: result.ok ? [] : result.errors }
}

const validateDd: Validator = (input, charset) => {
  const result = validateDirectDebit(input, { charset })
  return { ok: result.ok, issues: result.ok ? [] : result.errors }
}

function messageAt(issues: z.core.$ZodIssue[], path: Array<string | number>): string | undefined {
  return issues.find((issue) => JSON.stringify(issue.path) === JSON.stringify(path))?.message
}

async function expectXsdValid(xml: string): Promise<void> {
  const xsd = await validateXsd(xml)
  expect(xsd.valid, xsd.errors.join(', ')).toBe(true)
}

/** The written XML validates against its XSD and parses back to the model. */
async function expectXsdValidRoundTrip(xml: string, doc: unknown): Promise<void> {
  await expectXsdValid(xml)
  const parsed = parse(xml)
  expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true)
  if (parsed.ok) expect(parsed.data).toEqual(doc)
}

/** The message of the first validation error, failing the test when validation passed. */
function firstErrorMessage(result: { ok: boolean; errors?: z.core.$ZodIssue[] }): string {
  expect(result.ok).toBe(false)
  return result.errors?.[0]?.message ?? ''
}

// ---------------------------------------------------------------------------
// The issue's example
// ---------------------------------------------------------------------------

describe('issue #45: "Maja Štupica" as a creditor name', () => {
  const extendedDoc = withCreditorName(MINIMAL_DD, 'Maja Štupica')

  it('should reject the name by default, naming the character, the option and the helper', () => {
    expect(() => writeDirectDebit(extendedDoc)).toThrow(Error)
    let message = ''
    try {
      writeDirectDebit(extendedDoc)
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
    }
    expect(message).toContain('creditor.name: ')
    expect(message).toContain('"Š" (U+0160)')
    expect(message).toContain("{ charset: 'extended' }")
    expect(message).toContain('toSepaCharset(value)')
  })

  it('should write an XSD-valid file with { charset: extended } that parses back to the model', async () => {
    const xml = writeDirectDebit(extendedDoc, EXTENDED)
    expect(xml).toContain('<Nm>Maja Štupica</Nm>')
    await expectXsdValidRoundTrip(xml, extendedDoc)
  })

  it('should accept SepaCharset.Extended and the raw string alike', () => {
    expect(writeDirectDebit(extendedDoc, { charset: SepaCharset.Extended })).toBe(
      writeDirectDebit(extendedDoc, { charset: 'extended' })
    )
  })

  it('should convert the name with toSepaCharset to a value the default mode writes', () => {
    expect(toSepaCharset('Maja Štupica')).toBe('Maja Stupica')
    const xml = writeDirectDebit(withCreditorName(MINIMAL_DD, toSepaCharset('Maja Štupica')))
    expect(xml).toContain('<Nm>Maja Stupica</Nm>')
  })

  it('should do the same for a credit transfer creditor name and remittance information', async () => {
    const doc = withTransferText('Maja Štupica', 'Plačilo računa čšž')
    expect(() => writeCreditTransfer(doc)).toThrow(/creditor\.name: .*"Š" \(U\+0160\)/)
    expect(() => writeCreditTransfer(doc)).toThrow(/remittanceInfo: .*"č" \(U\+010D\)/)
    const xml = writeCreditTransfer(doc, EXTENDED)
    await expectXsdValidRoundTrip(xml, doc)
    expect(toSepaCharset('Plačilo računa čšž')).toBe('Placilo racuna csz')
  })
})

// ---------------------------------------------------------------------------
// Field kinds
// ---------------------------------------------------------------------------

describe('field kinds: every string field of both models is classified', () => {
  it('should classify every string leaf of CreditTransferDocumentSchema, and nothing else', () => {
    expect(new Set(stringLeafPaths(CreditTransferDocumentSchema))).toEqual(
      new Set(Object.keys(CREDIT_TRANSFER_KINDS))
    )
  })

  it('should classify every string leaf of DirectDebitDocumentSchema, and nothing else', () => {
    expect(new Set(stringLeafPaths(DirectDebitDocumentSchema))).toEqual(
      new Set(Object.keys(DIRECT_DEBIT_KINDS))
    )
  })

  it('should start from full documents that are valid in both charsets', () => {
    for (const branch of ['A', 'B'] as const) {
      for (const remittance of ['structured', 'unstructured'] as const) {
        for (const charset of ['basic', 'extended'] as const) {
          expect(validateCt(fullCreditTransfer(branch, remittance), charset)).toEqual({
            ok: true,
            issues: [],
          })
          expect(validateDd(fullDirectDebit(branch, remittance), charset)).toEqual({
            ok: true,
            issues: [],
          })
        }
      }
    }
  })
})

const MODELS = [
  {
    model: 'pain.001',
    kinds: CREDIT_TRANSFER_KINDS,
    docs: [
      fullCreditTransfer('A'),
      fullCreditTransfer('B'),
      fullCreditTransfer('A', 'unstructured'),
    ],
    validate: validateCt,
  },
  {
    model: 'pain.008',
    kinds: DIRECT_DEBIT_KINDS,
    docs: [fullDirectDebit('A'), fullDirectDebit('B'), fullDirectDebit('A', 'unstructured')],
    validate: validateDd,
  },
] as const

function documentWith(docs: readonly unknown[], path: Array<string | number>, value: string) {
  for (const doc of docs) {
    const changed = withValueAt(doc, path, value)
    if (changed !== null) return changed
  }
  throw new Error(`no fixture document has a string at ${path.join('.')}`)
}

for (const { model, kinds, docs, validate } of MODELS) {
  describe(`field kinds (${model})`, () => {
    for (const [pattern, kind] of Object.entries(kinds)) {
      const path = concretePath(pattern)

      if (kind === 'text') {
        it(`${pattern}: text, accepts "Š" only with { charset: extended }`, () => {
          const doc = documentWith(docs, path, 'Š')
          expect(validate(doc, 'extended')).toEqual({ ok: true, issues: [] })
          const basic = validate(doc, 'basic')
          expect(basic.ok).toBe(false)
          const message = messageAt(basic.issues, path)
          expect(message).toContain(`${CHARSET_PREFIX}"Š" (U+0160).`)
          expect(message).toContain(OPT_IN_HINT)
        })
      } else if (kind === 'reference' || kind === 'identifier') {
        it(`${pattern}: ${kind}, rejects "Ž" in both charsets (section 6.3)`, () => {
          const doc = documentWith(docs, path, 'Ž')
          for (const charset of ['basic', 'extended'] as const) {
            const result = validate(doc, charset)
            expect(result.ok).toBe(false)
            const message = messageAt(result.issues, path)
            expect(message).toContain(`${CHARSET_PREFIX}"Ž" (U+017D).`)
            expect(message).toContain(SECTION_6_3)
          }
        })
      } else {
        it(`${pattern}: structured, rejects "Š" in both charsets`, () => {
          const doc = documentWith(docs, path, 'Š')
          for (const charset of ['basic', 'extended'] as const) {
            const result = validate(doc, charset)
            expect(result.ok).toBe(false)
            expect(messageAt(result.issues, path)).toBeDefined()
          }
        })
      }
    }
  })
}

describe('field kinds: property over identifiers and references', () => {
  const greenCharacters = [...EPC217_08_EXTENDED_ONLY]

  for (const { model, kinds, docs, validate } of MODELS) {
    const basicOnly = Object.entries(kinds)
      .filter(([, kind]) => kind === 'reference' || kind === 'identifier')
      .map(([pattern]) => pattern)

    it(`${model}: a green character in any identifier or reference fails in both charsets (numRuns=200)`, () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...basicOnly),
          fc.constantFrom(...greenCharacters),
          (pattern, green) => {
            const doc = documentWith(docs, concretePath(pattern), green)
            expect(validate(doc, 'basic').ok).toBe(false)
            expect(validate(doc, 'extended').ok).toBe(false)
          }
        ),
        { numRuns: 200 }
      )
    })
  }
})

// ---------------------------------------------------------------------------
// German DK variants
// ---------------------------------------------------------------------------

describe('German DK variants refuse { charset: extended }', () => {
  it('pain.001.003.03 throws even for an ASCII-only document, and before validation', () => {
    const expected =
      "charset 'extended' is not supported for variant pain.001.003.03: the German DK formats define their own character rules (DFU-Abkommen Anlage 3), which this library does not ship. Use variant pain.001.001.09, or convert text fields with toSepaCharset(value)."
    expect(() =>
      writeCreditTransfer(MINIMAL_CT, { variant: 'pain.001.003.03', charset: 'extended' })
    ).toThrow(expected)
    const invalid = { ...MINIMAL_CT, messageId: '' }
    expect(() =>
      writeCreditTransfer(invalid, { variant: 'pain.001.003.03', charset: 'extended' })
    ).toThrow(expected)
    expect(() => writeCreditTransfer(MINIMAL_CT, { variant: 'pain.001.003.03' })).not.toThrow()
    expect(() =>
      writeCreditTransfer(MINIMAL_CT, { variant: 'pain.001.003.03', charset: 'basic' })
    ).not.toThrow()
  })

  it('pain.008.003.02 throws even for an ASCII-only document, and before validation', () => {
    const expected =
      "charset 'extended' is not supported for variant pain.008.003.02: the German DK formats define their own character rules (DFU-Abkommen Anlage 3), which this library does not ship. Use variant pain.008.001.08, or convert text fields with toSepaCharset(value)."
    expect(() =>
      writeDirectDebit(MINIMAL_DD, { variant: 'pain.008.003.02', charset: 'extended' })
    ).toThrow(expected)
    const invalid = { ...MINIMAL_DD, messageId: '' }
    expect(() =>
      writeDirectDebit(invalid, { variant: 'pain.008.003.02', charset: 'extended' })
    ).toThrow(expected)
    expect(() => writeDirectDebit(MINIMAL_DD, { variant: 'pain.008.003.02' })).not.toThrow()
  })

  it('parse still accepts extended text in DK files (lenient receiver)', () => {
    const ct = writeCreditTransfer(MINIMAL_CT, { variant: 'pain.001.003.03' }).replace(
      '<Nm>Creditor</Nm>',
      '<Nm>Maja Štupica</Nm>'
    )
    const ctParsed = parse(ct)
    expect(ctParsed.ok).toBe(true)
    if (ctParsed.ok && ctParsed.type === 'pain.001') {
      expect(ctParsed.data.batches[0]?.transfers[0]?.creditor.name).toBe('Maja Štupica')
    }
    const dd = writeDirectDebit(MINIMAL_DD, { variant: 'pain.008.003.02' }).replace(
      '<Nm>Debtor</Nm>',
      '<Nm>Žan Novak</Nm>'
    )
    const ddParsed = parse(dd)
    expect(ddParsed.ok).toBe(true)
    if (ddParsed.ok && ddParsed.type === 'pain.008') {
      expect(ddParsed.data.batches[0]?.collections[0]?.debtor.name).toBe('Žan Novak')
    }
  })

  it('basic-mode messages point only to toSepaCharset, never to the extended opt-in', () => {
    const variants: Array<[string, () => unknown]> = [
      [
        'pain.001.003.03',
        () =>
          writeCreditTransfer(withTransferText('Maja Štupica', 'Invoice 1'), {
            variant: 'pain.001.003.03',
          }),
      ],
      [
        'pain.008.003.02',
        () =>
          writeDirectDebit(withCreditorName(MINIMAL_DD, 'Maja Štupica'), {
            variant: 'pain.008.003.02',
          }),
      ],
    ]
    for (const [variant, write] of variants) {
      let message = ''
      try {
        write()
      } catch (e) {
        message = e instanceof Error ? e.message : String(e)
      }
      expect(message, variant).toContain(
        `creditor.name: ${CHARSET_PREFIX}"Š" (U+0160). This variant allows only the basic Latin set (a-z A-Z 0-9 space / - ? : ( ) . , ' +). Convert the value with toSepaCharset(value).`
      )
      expect(message, variant).not.toContain('{ charset')
    }
    expect(() => writeCreditTransfer(withTransferText('Maja Štupica', 'Invoice 1'))).toThrow(
      OPT_IN_HINT
    )
  })

  it('the legacy ISO pain.001.001.03 accepts extended text', async () => {
    const doc = withTransferText('Maja Štupica', 'Plačilo')
    const xml = writeCreditTransfer(doc, { variant: 'pain.001.001.03', charset: 'extended' })
    await expectXsdValidRoundTrip(xml, doc)
  })
})

// ---------------------------------------------------------------------------
// XML escaping, length and encoding
// ---------------------------------------------------------------------------

describe('the no-break space (U+00A0) is not accepted in extended text (decision, NOTICE.md)', () => {
  const name = 'Maja\u00A0Štupica'

  it('should reject it in validate and write, in both charsets', () => {
    const doc = withCreditorName(MINIMAL_DD, name)
    for (const charset of ['basic', 'extended'] as const) {
      expect(firstErrorMessage(validateDirectDebit(doc, { charset }))).toContain(
        'the no-break space (U+00A0)'
      )
      expect(() => writeDirectDebit(doc, { charset })).toThrow('creditor.name: ')
    }
  })

  it('should reject it in a received file, also with the default extended parse', () => {
    const xml = writeDirectDebit(withCreditorName(MINIMAL_DD, 'Maja Štupica'), EXTENDED).replace(
      '<Nm>Maja Štupica</Nm>',
      `<Nm>${name}</Nm>`
    )
    const result = parse(xml)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('creditor.name: ')
  })

  it('should convert it to a space for both targets, and the converted name round-trips', async () => {
    expect(toSepaCharset(name)).toBe('Maja Stupica')
    const converted = toSepaCharset(name, EXTENDED)
    expect(converted).toBe('Maja Štupica')
    const doc = withCreditorName(MINIMAL_DD, converted)
    await expectXsdValidRoundTrip(writeDirectDebit(doc, EXTENDED), doc)
  })
})

describe('extended text: XML escaping and length', () => {
  it('should escape the five XML special characters, validate and round-trip', async () => {
    const name = `A & B <C> "D" 'E'`
    const doc = withCreditorName(MINIMAL_DD, name)
    expect(() => writeDirectDebit(doc)).toThrow(/"&" \(U\+0026\)/)
    const xml = writeDirectDebit(doc, EXTENDED)
    expect(xml).toContain('<Nm>A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;</Nm>')
    await expectXsdValidRoundTrip(xml, doc)
  })

  it('should count each extended character once against the 70-character limit', async () => {
    const seventy = withCreditorName(MINIMAL_DD, 'Щ'.repeat(70))
    const xml = writeDirectDebit(seventy, EXTENDED)
    await expectXsdValid(xml)
    const tooLong = validateDirectDebit(withCreditorName(MINIMAL_DD, 'Щ'.repeat(71)), EXTENDED)
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) {
      expect(tooLong.errors[0]?.path).toEqual(['creditor', 'name'])
      expect(tooLong.errors[0]?.code).toBe('too_big')
    }
  })

  it('should never truncate: toSepaCharset of 70 x Щ is 210 characters and fails the limit', () => {
    const converted = toSepaCharset('Щ'.repeat(70))
    expect(converted).toBe('SHT'.repeat(70))
    expect(converted).toHaveLength(210)
    const result = validateDirectDebit(withCreditorName(MINIMAL_DD, converted))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]?.code).toBe('too_big')
  })

  it('should emit extended characters raw in a UTF-8 document', () => {
    const xml = writeDirectDebit(withCreditorName(MINIMAL_DD, 'Ž€'), EXTENDED)
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<Nm>Ž€</Nm>')
  })
})

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

describe('charset option validation', () => {
  const unknown = { charset: 'latin1' as never }
  const message = `Unknown charset "latin1": expected 'basic' or 'extended' (SepaCharset.Basic, SepaCharset.Extended)`

  it('write and validate throw on an unknown charset; parse returns ok:false', () => {
    expect(() => writeCreditTransfer(MINIMAL_CT, unknown)).toThrow(message)
    expect(() => writeDirectDebit(MINIMAL_DD, unknown)).toThrow(message)
    expect(() => validateCreditTransfer(MINIMAL_CT, unknown)).toThrow(message)
    expect(() => validateDirectDebit(MINIMAL_DD, unknown)).toThrow(message)
    const parsed = parse(writeCreditTransfer(MINIMAL_CT), unknown)
    expect(parsed).toEqual({ ok: false, error: message })
  })

  it('validate defaults to basic and parse defaults to extended', () => {
    const doc = withCreditorName(MINIMAL_DD, 'Maja Štupica')
    expect(validateDirectDebit(doc).ok).toBe(false)
    expect(validateDirectDebit(doc, EXTENDED).ok).toBe(true)
    const xml = writeDirectDebit(doc, EXTENDED)
    expect(parse(xml).ok).toBe(true)
    expect(parse(xml, { charset: 'extended' }).ok).toBe(true)
    const strict = parse(xml, { charset: 'basic' })
    expect(strict.ok).toBe(false)
    if (!strict.ok) expect(strict.error).toContain('creditor.name: ')
  })

  it('a parsed extended document needs { charset: extended } to be written again', () => {
    const xml = writeDirectDebit(withCreditorName(MINIMAL_DD, 'Maja Štupica'), EXTENDED)
    const parsed = parse(xml)
    if (!parsed.ok || parsed.type !== 'pain.008') throw new Error('expected a pain.008 parse')
    expect(() => writeDirectDebit(parsed.data)).toThrow(OPT_IN_HINT)
    expect(writeDirectDebit(parsed.data, EXTENDED)).toBe(xml)
  })
})

describe('the default charset of every entry point', () => {
  const name = 'Maja Štupica'
  const creditTransfer = withTransferText(name, 'Invoice 1')
  const directDebit = withCreditorName(MINIMAL_DD, name)

  /** The message a call throws, failing the test when it does not throw. */
  function thrownMessage(call: () => unknown): string {
    try {
      call()
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
    throw new Error('expected the call to throw')
  }

  it('writeCreditTransfer defaults to basic and names the opt-in', () => {
    const message = thrownMessage(() => writeCreditTransfer(creditTransfer))
    expect(message).toContain('batches.0.transfers.0.creditor.name: ')
    expect(message).toContain('"Š" (U+0160)')
    expect(message).toContain(OPT_IN_HINT)
    expect(writeCreditTransfer(creditTransfer, EXTENDED)).toContain(`<Nm>${name}</Nm>`)
  })

  it('writeDirectDebit defaults to basic and names the opt-in', () => {
    const message = thrownMessage(() => writeDirectDebit(directDebit))
    expect(message).toContain('creditor.name: ')
    expect(message).toContain(OPT_IN_HINT)
    expect(writeDirectDebit(directDebit, EXTENDED)).toContain(`<Nm>${name}</Nm>`)
  })

  it('validateCreditTransfer defaults to basic and names the opt-in', () => {
    const result = validateCreditTransfer(creditTransfer)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((issue) => issue.path.join('.'))).toEqual([
      'batches.0.transfers.0.creditor.name',
    ])
    expect(firstErrorMessage(result)).toContain('"Š" (U+0160)')
    expect(firstErrorMessage(result)).toContain(OPT_IN_HINT)
    expect(validateCreditTransfer(creditTransfer, EXTENDED).ok).toBe(true)
  })

  it('validateDirectDebit defaults to basic and names the opt-in', () => {
    const result = validateDirectDebit(directDebit)
    expect(firstErrorMessage(result)).toContain(OPT_IN_HINT)
    expect(validateDirectDebit(directDebit, EXTENDED).ok).toBe(true)
  })

  it('parse defaults to extended for both message types', () => {
    for (const xml of [
      writeCreditTransfer(creditTransfer, EXTENDED),
      writeDirectDebit(directDebit, EXTENDED),
    ]) {
      const result = parse(xml)
      expect(result.ok, result.ok ? '' : result.error).toBe(true)
      expect(result).toEqual(parse(xml, EXTENDED))
      expect(parse(xml, { charset: 'basic' }).ok).toBe(false)
    }
  })

  it('toSepaCharset defaults to the basic target', () => {
    expect(toSepaCharset(name)).toBe('Maja Stupica')
    expect(toSepaCharset(name, {})).toBe('Maja Stupica')
    expect(toSepaCharset(name, EXTENDED)).toBe(name)
  })
})

describe('writer error messages keep one issue per "; " separator', () => {
  it('should split into exactly the failing fields, with a semicolon in a value', () => {
    const doc = withTransferText('A;B', 'Plačilo; računa')
    let message = ''
    try {
      writeCreditTransfer(doc)
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
    }
    const issues = message.replace('Invalid CreditTransferDocument: ', '').split('; ')
    expect(issues.map((issue) => issue.slice(0, issue.indexOf(':')))).toEqual([
      'batches.0.transfers.0.creditor.name',
      'batches.0.transfers.0.remittanceInfo',
    ])
    expect(issues[0]).toContain('the semicolon (U+003B)')
    expect(issues[1]).toContain('"č" (U+010D), the semicolon (U+003B)')
  })
})

describe('extended mode messages', () => {
  it('should name characters outside the extended set and point to both helper targets', () => {
    const doc = withCreditorName(MINIMAL_DD, 'Maja \u{1F600}')
    expect(firstErrorMessage(validateDirectDebit(doc, EXTENDED))).toBe(
      `${CHARSET_PREFIX}"\u{1F600}" (U+1F600). This character is not in the EPC217-08 extended character set. Convert the value with toSepaCharset(value, { charset: 'extended' }) to keep local-language characters, or with toSepaCharset(value) for basic Latin.`
    )
  })

  it('should not suggest the extended set when it would not help', () => {
    const doc = withCreditorName(MINIMAL_DD, 'Š \u{1F600}')
    expect(firstErrorMessage(validateDirectDebit(doc))).toBe(
      `${CHARSET_PREFIX}"Š" (U+0160), "\u{1F600}" (U+1F600). Only the basic Latin set is allowed (a-z A-Z 0-9 space / - ? : ( ) . , ' +), and "\u{1F600}" (U+1F600) is not in the EPC217-08 extended set either. Convert the value with toSepaCharset(value).`
    )
  })

  it('should reject decomposed text (NFD) in both modes with a normalization hint', () => {
    const doc = withCreditorName(MINIMAL_DD, 'S\u030Ctupica')
    for (const charset of ['basic', 'extended'] as const) {
      const message = firstErrorMessage(validateDirectDebit(doc, { charset }))
      expect(message).toContain('"\u030C" (U+030C)')
      expect(message).toContain("value.normalize('NFC')")
    }
    const composed = withCreditorName(MINIMAL_DD, 'S\u030Ctupica'.normalize('NFC'))
    expect(validateDirectDebit(composed, EXTENDED).ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Parse of hand-written XML with local-language characters
// ---------------------------------------------------------------------------

const SNAPSHOTS_DIR = join(__dirname, 'golden/snapshots')

const TEXT_VALUES = {
  name: 'Maja Štupica',
  town: 'Škofja Loka',
  remittance: 'Plačilo računa čšž',
}

/** Encode every non-ASCII character as a numeric reference, alternating decimal and hex. */
function asReferences(text: string): string {
  let index = 0
  return [...text]
    .map((ch) => {
      const cp = ch.codePointAt(0) ?? 0
      if (cp < 0x80) return ch
      index++
      return index % 2 === 0 ? `&#${cp};` : `&#x${cp.toString(16)};`
    })
    .join('')
}

function localisedSnapshot(file: string, encode: (text: string) => string): string {
  const xml = readFileSync(join(SNAPSHOTS_DIR, file), 'utf-8')
  const debtorTag = file.startsWith('pain.008') ? 'Dbtr' : 'Cdtr'
  const firstParty = file.startsWith('pain.008') ? 'Customer One' : 'Supplier One'
  const firstRemittance = file.startsWith('pain.008')
    ? 'First collection Jan 2025'
    : 'Invoice 2025/001'
  const replaced = xml
    .replace(
      `<${debtorTag}>\n          <Nm>${firstParty}</Nm>\n        </${debtorTag}>`,
      `<${debtorTag}>\n          <Nm>${encode(TEXT_VALUES.name)}</Nm>\n          <PstlAdr>\n            <TwnNm>${encode(TEXT_VALUES.town)}</TwnNm>\n            <Ctry>SI</Ctry>\n          </PstlAdr>\n        </${debtorTag}>`
    )
    .replace(
      `<Ustrd>${firstRemittance}</Ustrd>`,
      `<Ustrd>${encode(TEXT_VALUES.remittance)}</Ustrd>`
    )
  if (!replaced.includes('<TwnNm>') || !replaced.includes(encode(TEXT_VALUES.remittance))) {
    throw new Error(`snapshot ${file} no longer matches the replacement anchors`)
  }
  return replaced
}

describe('parse of XML with č š ž, raw and as numeric character references', () => {
  const encodings = [
    ['raw UTF-8', (text: string) => text],
    ['numeric references', asReferences],
  ] as const

  for (const [label, encode] of encodings) {
    it(`pain.001.001.09 (${label}): parses with decoded values, strict parse names the characters, XSD-valid`, async () => {
      const xml = localisedSnapshot('pain.001.001.09.xml', encode)
      const parsed = parse(xml)
      if (!parsed.ok || parsed.type !== 'pain.001') throw new Error('expected pain.001')
      const transfer = parsed.data.batches[0]?.transfers[0]
      expect(transfer?.creditor.name).toBe(TEXT_VALUES.name)
      expect(transfer?.creditor.address?.townName).toBe(TEXT_VALUES.town)
      expect(transfer?.remittanceInfo).toBe(TEXT_VALUES.remittance)
      const strict = parse(xml, { charset: 'basic' })
      expect(strict.ok).toBe(false)
      if (!strict.ok) {
        expect(strict.error).toContain('"Š" (U+0160)')
        expect(strict.error).toContain('"č" (U+010D)')
      }
      await expectXsdValid(xml)
    })

    it(`pain.008.001.08 (${label}): parses with decoded values, strict parse names the characters, XSD-valid`, async () => {
      const xml = localisedSnapshot('pain.008.001.08.xml', encode)
      const parsed = parse(xml)
      if (!parsed.ok || parsed.type !== 'pain.008') throw new Error('expected pain.008')
      const collection = parsed.data.batches[0]?.collections[0]
      expect(collection?.debtor.name).toBe(TEXT_VALUES.name)
      expect(collection?.debtor.address?.townName).toBe(TEXT_VALUES.town)
      expect(collection?.remittanceInfo).toBe(TEXT_VALUES.remittance)
      const strict = parse(xml, { charset: 'basic' })
      expect(strict.ok).toBe(false)
      if (!strict.ok) expect(strict.error).toContain('"ž" (U+017E)')
      await expectXsdValid(xml)
    })
  }

  it('should reject an extended character in an identifier even though parse defaults to extended', () => {
    const xml = readFileSync(join(SNAPSHOTS_DIR, 'pain.008.001.08.xml'), 'utf-8').replace(
      '<MndtId>GOLDEN-MAND-001</MndtId>',
      '<MndtId>MAND-Ž</MndtId>'
    )
    const parsed = parse(xml)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain(SECTION_6_3)
  })
})
