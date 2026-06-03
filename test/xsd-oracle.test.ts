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
import { sanitizeSepa } from '../src/model/charset.js'
import { buildCreditorId, isValidCreditorId } from '../src/model/creditor-id.js'
import { euros, formatMoney } from '../src/model/schema.js'
import type {
  CreditTransferDocument,
  AccountParty,
  Transfer,
  PaymentBatch,
  UltimateParty,
  PartyIdentification,
  GenericIdentification,
  StructuredRemittance,
  Purpose,
} from '../src/model/schema.js'
import type {
  DirectDebitDocument,
  DirectDebitBatch,
  Collection,
  Creditor,
  SequenceType,
  LocalInstrument,
  MandateAmendment,
} from '../src/model/pain008.js'
import {
  arbIban,
  arbSepaText,
  arbSepaIdentifier,
  arbCreatedAt,
  arbDate,
  arbPartyName,
  arbBic,
  arbMoney,
  arbPostalAddress,
  withOptionalAddress,
} from './arbitraries.js'

/**
 * Arbitrary for a valid LEI (18 alphanumerics + 2 check digits). Format-valid only:
 * our LEI validation checks the lexical pattern, not the ISO 17442 check digits.
 */
function arbLei(): fc.Arbitrary<string> {
  const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return fc
    .record({
      body: fc.string({ unit: fc.constantFrom(...ALNUM.split('')), minLength: 18, maxLength: 18 }),
      check: fc.string({
        unit: fc.constantFrom(...'0123456789'.split('')),
        minLength: 2,
        maxLength: 2,
      }),
    })
    .map(({ body, check }) => body + check)
}

/**
 * Arbitrary for a generic identifier (Othr): Id plus optional SchmeNm/Cd and Issr.
 * All text uses the trimmed SEPA charset so it survives the XML round-trip. Absent
 * keys are stripped to match what the parser returns (no undefined-valued keys).
 */
function arbGenericIdentification(): fc.Arbitrary<GenericIdentification> {
  return fc
    .record({
      id: arbSepaText(1, 35),
      schemeName: fc.option(arbSepaText(1, 4), { nil: undefined }),
      issuer: fc.option(arbSepaText(1, 35), { nil: undefined }),
    })
    .map(({ id, schemeName, issuer }) => {
      const out: GenericIdentification = { id }
      if (schemeName !== undefined) out.schemeName = schemeName
      if (issuer !== undefined) out.issuer = issuer
      return out
    })
}

/**
 * Arbitrary for a structured party identification (Party38Choice): exactly one of
 * an organisation id (OrgId) or a private id (PrvtId).
 *
 * Constraints that keep it round-trip-safe and XSD-valid:
 * - bic uses the known-good BIC constants; lei is format-valid (pattern only).
 * - At least one branch field is always set (the model rejects empty OrgId/PrvtId).
 * - birthDate uses arbDate; countryOfBirth is a valid 2-letter code.
 * - Absent optional keys are stripped so the generated model deep-equals the parsed one.
 */
function arbPartyIdentification(): fc.Arbitrary<PartyIdentification> {
  const arbOrg = fc
    .record({
      bic: fc.option(arbBic(), { nil: undefined }),
      lei: fc.option(arbLei(), { nil: undefined }),
      other: fc.option(arbGenericIdentification(), { nil: undefined }),
    })
    // Guarantee at least one field is set (empty OrgId is rejected by the model).
    .filter((o) => o.bic !== undefined || o.lei !== undefined || o.other !== undefined)
    .map((o) => {
      const org: Record<string, unknown> = {}
      if (o.bic !== undefined) org['bic'] = o.bic
      if (o.lei !== undefined) org['lei'] = o.lei
      if (o.other !== undefined) org['other'] = o.other
      return { organisationId: org } as PartyIdentification
    })

  const arbPrvt = fc
    .record({
      dob: fc.option(
        fc.record({
          birthDate: arbDate(),
          provinceOfBirth: fc.option(arbSepaText(1, 35), { nil: undefined }),
          cityOfBirth: arbSepaText(1, 35),
          countryOfBirth: fc.constantFrom('DE', 'FR', 'NL', 'ES', 'IT', 'BE', 'AT'),
        }),
        { nil: undefined }
      ),
      other: fc.option(arbGenericIdentification(), { nil: undefined }),
    })
    // Guarantee at least one field is set (empty PrvtId is rejected by the model).
    .filter((p) => p.dob !== undefined || p.other !== undefined)
    .map((p) => {
      const prvt: Record<string, unknown> = {}
      if (p.dob !== undefined) {
        const dob: Record<string, unknown> = {
          birthDate: p.dob.birthDate,
          cityOfBirth: p.dob.cityOfBirth,
          countryOfBirth: p.dob.countryOfBirth,
        }
        if (p.dob.provinceOfBirth !== undefined) dob['provinceOfBirth'] = p.dob.provinceOfBirth
        prvt['dateAndPlaceOfBirth'] = dob
      }
      if (p.other !== undefined) prvt['other'] = p.other
      return { privateId: prvt } as PartyIdentification
    })

  return fc.oneof(arbOrg, arbPrvt)
}

/**
 * Arbitrary for an optional UltimateParty: always a name (max 70 chars, SEPA
 * charset), plus an optional structured Id (OrgId XOR PrvtId).
 *
 * Uses arbSepaText to guarantee names survive XML round-trip (no trailing
 * whitespace, SEPA charset only). The fc.option with nil:undefined produces an
 * absent party ~50% of the time, and within a present party the id is itself
 * optional, so all of {no party, name only, name + id} are exercised.
 */
function arbUltimateParty(): fc.Arbitrary<UltimateParty | undefined> {
  return fc.option(
    fc
      .record({
        name: arbSepaText(1, 70),
        id: fc.option(arbPartyIdentification(), { nil: undefined }),
      })
      .map(({ name, id }) => (id === undefined ? { name } : { name, id })),
    { nil: undefined }
  )
}

/**
 * Known-valid ISO 11649 creditor references (RF + check digits). These satisfy
 * the MOD 97-10 check, so they exercise the RF validation path without flaking.
 * RF18539007547034 is the canonical ISO 11649 example.
 */
const VALID_RF_REFS = ['RF18539007547034']

/**
 * Arbitrary for a StructuredRemittance value (RmtInf/Strd/CdtrRefInf).
 *
 * Two constraints keep this round-trip-safe:
 * 1. The creditorReference is EITHER a non-RF reference (so the conditional ISO 11649
 *    check never triggers) OR one of the known-valid RF references above. We never
 *    generate "RF" + random digits, which would fail the check digit.
 * 2. referenceType is ALWAYS set explicitly. The writer defaults an omitted
 *    referenceType to "SCOR", so the parser would read back "SCOR" and break
 *    deep-equal. Setting it explicitly avoids that asymmetry (the omitted-default
 *    behavior is pinned in the structured-remittance unit test instead).
 */
/**
 * Reference type (CdtrRefInf/Tp/CdOrPrtry): a DocumentType3Code Cd string XOR a
 * Prtry object. Always set explicitly so the writer's SCOR default never breaks
 * round-trip deep-equal (see arbStructuredRemittanceValue note 2).
 */
function arbReferenceTypeValue(): fc.Arbitrary<StructuredRemittance['referenceType']> {
  const arbCd = fc.constantFrom<string>('RADM', 'RPIN', 'FXDR', 'DISP', 'PUOR', 'SCOR')
  const arbPrtry = arbSepaText(1, 35).map((v) => ({ proprietary: v }))
  return fc.oneof(arbCd, arbPrtry) as fc.Arbitrary<StructuredRemittance['referenceType']>
}

/** DocumentType6Code values for a referred-document type Cd. */
const DOC_TYPE6_CODES = [
  'MSIN',
  'CNFA',
  'CINV',
  'CREN',
  'DEBN',
  'HIRI',
  'SOAC',
  'BOLD',
  'VCHR',
] as const

/**
 * One referred document (RfrdDocInf): an optional type (Cd XOR Prtry), number,
 * and related date. Always sets at least one field (the model requires it). All
 * text is SEPA-charset and dates are YYYY-MM-DD so the value survives round-trip.
 */
function arbReferredDocument(): fc.Arbitrary<
  NonNullable<StructuredRemittance['referredDocuments']>[number]
> {
  const arbType = fc.oneof(
    fc.constantFrom<string>(...DOC_TYPE6_CODES),
    arbSepaText(1, 35).map((v) => ({ proprietary: v }))
  )
  return fc
    .record({
      type: fc.option(arbType, { nil: undefined }),
      number: fc.option(arbSepaText(1, 35), { nil: undefined }),
      relatedDate: fc.option(arbDate(), { nil: undefined }),
    })
    .map((d) => {
      const out: Record<string, unknown> = {}
      if (d.type !== undefined) out['type'] = d.type
      if (d.number !== undefined) out['number'] = d.number
      if (d.relatedDate !== undefined) out['relatedDate'] = d.relatedDate
      // Guarantee at least one field is present (the model rejects an empty RfrdDocInf).
      if (Object.keys(out).length === 0) out['number'] = d.number ?? 'INV-1'
      return out as NonNullable<StructuredRemittance['referredDocuments']>[number]
    })
}

/**
 * Referred-document amounts (RfrdDocAmt): any non-empty subset of duePayableAmount,
 * creditNoteAmount, remittedAmount, each an in-range EUR Money. Informational only.
 */
function arbRemittanceAmountValue(): fc.Arbitrary<
  NonNullable<StructuredRemittance['referredDocumentAmount']>
> {
  return fc
    .record({
      duePayableAmount: fc.option(arbMoney(), { nil: undefined }),
      creditNoteAmount: fc.option(arbMoney(), { nil: undefined }),
      remittedAmount: fc.option(arbMoney(), { nil: undefined }),
    })
    .map((a) => {
      const out: Record<string, unknown> = {}
      if (a.duePayableAmount !== undefined) out['duePayableAmount'] = a.duePayableAmount
      if (a.creditNoteAmount !== undefined) out['creditNoteAmount'] = a.creditNoteAmount
      if (a.remittedAmount !== undefined) out['remittedAmount'] = a.remittedAmount
      // Guarantee at least one amount (the model rejects an empty RfrdDocAmt).
      if (Object.keys(out).length === 0)
        out['remittedAmount'] = a.remittedAmount ?? arbMoneyFallback
      return out as NonNullable<StructuredRemittance['referredDocumentAmount']>
    })
}

/** A constant in-range EUR amount used as the empty-subset fallback above. */
const arbMoneyFallback = { currencyCode: 'EUR' as const, minorUnits: 100n }

/**
 * Arbitrary for a full structured remittance value (RmtInf/Strd), exercising
 * RfrdDocInf (including multiple), RfrdDocAmt, and CdtrRefInf with both the Cd and
 * Prtry reference-type paths.
 *
 * Round-trip-safety constraints:
 * 1. creditorReference is EITHER a non-RF reference (so the conditional ISO 11649
 *    check never triggers) OR one of the known-valid RF references. We never
 *    generate "RF" + random digits, which would fail the check digit.
 * 2. When creditorReference is present, referenceType is ALWAYS set explicitly.
 *    The writer defaults an omitted referenceType to "SCOR", so the parser would
 *    read back "SCOR" and break deep-equal. The omitted-default behaviour is
 *    pinned in the structured-remittance unit test instead.
 * 3. referenceType and issuer are only emitted when creditorReference is present,
 *    matching the model refinement, so they are omitted on the docs/amount-only path.
 * 4. At least one of referredDocuments / referredDocumentAmount / creditorReference
 *    is always present (an empty Strd is rejected by the model).
 */
function arbStructuredRemittanceValue(): fc.Arbitrary<StructuredRemittance> {
  const arbRef = fc.oneof(
    arbSepaText(1, 35).filter((s) => !s.trimStart().startsWith('RF')),
    fc.constantFrom(...VALID_RF_REFS)
  )
  const arbCdtrRef = fc.record({
    creditorReference: arbRef,
    referenceType: arbReferenceTypeValue(),
    issuer: fc.option(arbSepaText(1, 35), { nil: undefined }),
  })
  return fc
    .record({
      referredDocuments: fc.option(
        fc.array(arbReferredDocument(), { minLength: 1, maxLength: 3 }),
        {
          nil: undefined,
        }
      ),
      referredDocumentAmount: fc.option(arbRemittanceAmountValue(), { nil: undefined }),
      cdtrRef: fc.option(arbCdtrRef, { nil: undefined }),
    })
    .map((sr) => {
      const out: Record<string, unknown> = {}
      if (sr.referredDocuments !== undefined) out['referredDocuments'] = sr.referredDocuments
      if (sr.referredDocumentAmount !== undefined) {
        out['referredDocumentAmount'] = sr.referredDocumentAmount
      }
      if (sr.cdtrRef !== undefined) {
        out['creditorReference'] = sr.cdtrRef.creditorReference
        out['referenceType'] = sr.cdtrRef.referenceType
        if (sr.cdtrRef.issuer !== undefined) out['issuer'] = sr.cdtrRef.issuer
      }
      // Guarantee at least one component is present (an empty Strd is rejected).
      if (Object.keys(out).length === 0) {
        out['creditorReference'] = '12345'
        out['referenceType'] = 'SCOR'
      }
      return out as StructuredRemittance
    })
}

/**
 * Arbitrary for the remittance fields of a Transfer / Collection, respecting the
 * SEPA mutual-exclusion rule: at most ONE of remittanceInfo (Ustrd) or
 * structuredRemittance (Strd). Returns an object to spread onto the model.
 */
function arbRemittance(): fc.Arbitrary<Record<string, unknown>> {
  return fc.oneof(
    fc.constant<Record<string, unknown>>({}),
    arbSepaText(1, 140).map((r) => ({ remittanceInfo: r })),
    arbStructuredRemittanceValue().map((sr) => ({ structuredRemittance: sr }))
  )
}

/**
 * Arbitrary for an optional purpose (Purp or CtgyPurp), covering both paths:
 *   Cd   - a plain string (ExternalPurpose1Code, 1-4 chars SEPA charset).
 *   Prtry - an object { proprietary: string } (Max35Text, 1-35 chars SEPA charset).
 *
 * Sharing this single helper for both pain.001 and pain.008 avoids duplication
 * (the field type Purpose = string | { proprietary: string } is identical in both models).
 * SEPA-charset, no trailing whitespace, and valid lengths are guaranteed by construction
 * so every generated value survives the XML round-trip and the XSD oracle.
 */
function arbPurposeCode(): fc.Arbitrary<Purpose | undefined> {
  const arbCd: fc.Arbitrary<Purpose> = fc.constantFrom<string>(
    'SALA',
    'SUPP',
    'TAXS',
    'OTHR',
    'GDDS'
  )
  const arbPrtry: fc.Arbitrary<Purpose> = arbSepaText(1, 35).map((v) => ({ proprietary: v }))
  return fc.option(fc.oneof(arbCd, arbPrtry), { nil: undefined })
}

/** Frequency6Code values supported by originalFrequency (Frequency36Choice/Tp). */
const FREQUENCY_CODES = [
  'YEAR',
  'MNTH',
  'QURT',
  'MIAN',
  'WEEK',
  'DAIL',
  'ADHO',
  'INDA',
  'FRTN',
] as const

/**
 * Arbitrary for the additive AmendmentInformationDetails13 fields introduced in #19.
 * Each field is independently optional. SMNDA is intentionally excluded (see arbMandateAmendment),
 * so originalDebtorAgent (a real BIC) is always free of the SMNDA mutual-exclusion conflict.
 */
function arbAmendmentExtraFields(): fc.Arbitrary<Partial<MandateAmendment>> {
  return fc
    .record({
      originalCreditorSchemeId: fc.option(
        fc.record(
          { name: fc.option(arbPartyName(), { nil: undefined }), creditorId: arbCreditorId() },
          { requiredKeys: ['creditorId'] }
        ),
        { nil: undefined }
      ),
      originalDebtor: fc.option(
        arbPartyName().map((name) => ({ name })),
        { nil: undefined }
      ),
      originalDebtorAgent: fc.option(arbBic(), { nil: undefined }),
      originalFinalCollectionDate: fc.option(arbDate(), { nil: undefined }),
      originalFrequency: fc.option(fc.constantFrom(...FREQUENCY_CODES), { nil: undefined }),
      originalReason: fc.option(
        fc.oneof(
          arbSepaText(1, 4),
          arbSepaText(1, 70).map((p) => ({ proprietary: p }))
        ),
        { nil: undefined }
      ),
    })
    .map((extra) => {
      const out: Partial<MandateAmendment> = {}
      if (extra.originalCreditorSchemeId !== undefined) {
        const scheme: { name?: string; creditorId: string } = {
          creditorId: extra.originalCreditorSchemeId.creditorId,
        }
        if (extra.originalCreditorSchemeId.name !== undefined)
          scheme.name = extra.originalCreditorSchemeId.name
        out.originalCreditorSchemeId = scheme
      }
      if (extra.originalDebtor !== undefined) out.originalDebtor = extra.originalDebtor
      if (extra.originalDebtorAgent !== undefined)
        out.originalDebtorAgent = extra.originalDebtorAgent
      if (extra.originalFinalCollectionDate !== undefined)
        out.originalFinalCollectionDate = extra.originalFinalCollectionDate
      if (extra.originalFrequency !== undefined) out.originalFrequency = extra.originalFrequency
      if (extra.originalReason !== undefined) out.originalReason = extra.originalReason
      return out
    })
}

/**
 * Arbitrary for an optional MandateAmendment (general-purpose, safe for any sequenceType).
 *
 * IMPORTANT: sameMandateNewDebtorAccount=true is NOT generated here because R4 requires
 * such collections to be in FRST-only batches. The general arbCollection does not know
 * the batch sequenceType, so generating SMNDA would cause non-FRST batches to throw.
 * SMNDA and R4 are covered by the dedicated unit tests in mandate-amendment.test.ts.
 *
 * Generated variants (all satisfy the not-empty and mutual-exclusion Zod refinements). A base
 * variant (originalMandateId and/or originalDebtorAccount) is merged with the additive #19 fields
 * (originalCreditorSchemeId, originalDebtor, originalDebtorAgent, originalFinalCollectionDate,
 * originalFrequency, originalReason). Because a base always sets at least one meaningful field,
 * the not-empty refinement always holds even when the extra fields happen to be empty.
 */
function arbMandateAmendment(): fc.Arbitrary<MandateAmendment | undefined> {
  const arbBase: fc.Arbitrary<MandateAmendment> = fc.oneof(
    arbSepaText(1, 35).map((id): MandateAmendment => ({ originalMandateId: id })),
    arbIban().map((iban): MandateAmendment => ({ originalDebtorAccount: iban })),
    fc.record({ originalMandateId: arbSepaText(1, 35), originalDebtorAccount: arbIban() }).map(
      (a): MandateAmendment => ({
        originalMandateId: a.originalMandateId,
        originalDebtorAccount: a.originalDebtorAccount,
      })
    )
  )
  return fc.oneof(
    fc.constant<MandateAmendment | undefined>(undefined),
    fc
      .record({ base: arbBase, extra: arbAmendmentExtraFields() })
      .map(({ base, extra }): MandateAmendment => ({ ...base, ...extra }))
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
      purpose: arbPurposeCode(),
      remittance: arbRemittance(),
    })
    .map((tx) => {
      // Strip undefined keys so the generated model matches what the parser returns
      // (absent fields must not appear as keys with undefined values).
      const out: Record<string, unknown> = {
        endToEndId: tx.endToEndId,
        amount: tx.amount,
        creditor: tx.creditor,
      }
      if (tx.ultimateDebtor !== undefined) out['ultimateDebtor'] = tx.ultimateDebtor
      if (tx.ultimateCreditor !== undefined) out['ultimateCreditor'] = tx.ultimateCreditor
      if (tx.purpose !== undefined) out['purpose'] = tx.purpose
      // remittance is {} | { remittanceInfo } | { structuredRemittance } (mutually exclusive).
      Object.assign(out, tx.remittance)
      return out as Transfer
    })
}

function arbPaymentBatch(): fc.Arbitrary<PaymentBatch> {
  return fc
    .record({
      id: arbSepaIdentifier(1, 35),
      executionDate: arbDate(),
      debtor: arbAccountParty(),
      categoryPurpose: arbPurposeCode(),
      transfers: fc.array(arbTransfer(), { minLength: 1, maxLength: 5 }),
    })
    .map((batch) => {
      // Strip undefined categoryPurpose key so the generated model matches what the
      // parser returns (absent fields must not appear as keys with undefined values).
      const out: Record<string, unknown> = {
        id: batch.id,
        executionDate: batch.executionDate,
        debtor: batch.debtor,
        transfers: batch.transfers,
      }
      if (batch.categoryPurpose !== undefined) out['categoryPurpose'] = batch.categoryPurpose
      return out as PaymentBatch
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
      nationalId: fc.string({
        unit: fc.constantFrom(...ALPHA_NUM.split('')),
        minLength: 1,
        maxLength: 10,
      }),
    })
    .map(({ country, nationalId }) => buildCreditorId(country, 'ZZZ', nationalId))
  // DE: national ID must be exactly 11 chars so total length is exactly 18
  const deArb = fc
    .string({ unit: fc.constantFrom(...ALPHA_NUM.split('')), minLength: 11, maxLength: 11 })
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
  const arbSignatureDate: fc.Arbitrary<string> = fc.integer({ min: 2000, max: cy }).chain((yr) => {
    if (yr < cy) {
      // Any month/day is guaranteed to be before the collection year.
      return fc
        .record({
          m: fc.integer({ min: 1, max: 12 }),
          d: fc.integer({ min: 1, max: 28 }),
        })
        .map(({ m, d }) => `${yr}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    }
    // yr === cy: constrain month <= cm to stay within the same year.
    return fc.integer({ min: 1, max: cm }).chain((mo) => {
      // If month is earlier, any day works; if equal month, day must be <= cd.
      const maxDay = mo < cm ? 28 : cd
      return fc
        .integer({ min: 1, max: maxDay })
        .map((d) => `${yr}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
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
      mandate: fc
        .record({
          // Minimum 10 chars reduces cross-document collision probability to < 1e-17 (R2/R3).
          // Mandate id is NOT subject to the slash rule (per the EPC rulebook).
          id: arbSepaText(10, 35),
          signatureDate: arbSignatureDate,
          amendment: arbMandateAmendment(),
        })
        .map((m) => {
          // Strip undefined amendment key so absent amendment does not appear as a key
          // with undefined value (would break round-trip deep-equal).
          const out: Record<string, unknown> = { id: m.id, signatureDate: m.signatureDate }
          if (m.amendment !== undefined) out['amendment'] = m.amendment
          return out as { id: string; signatureDate: string; amendment?: MandateAmendment }
        }),
      purpose: arbPurposeCode(),
      remittance: arbRemittance(),
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
      if (col.purpose !== undefined) out['purpose'] = col.purpose
      // remittance is {} | { remittanceInfo } | { structuredRemittance } (mutually exclusive).
      Object.assign(out, col.remittance)
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
      categoryPurpose: arbPurposeCode(),
    })
    .chain((batchBase) =>
      fc
        .array(arbCollection(batchBase.collectionDate), { minLength: 1, maxLength: 5 })
        .map((collections) => {
          // Strip an absent categoryPurpose key so the generated model matches what
          // the parser returns (undefined keys would break deep-equal).
          const { categoryPurpose, ...rest } = batchBase
          const batch: Record<string, unknown> = { ...rest, collections }
          if (categoryPurpose !== undefined) batch['categoryPurpose'] = categoryPurpose
          return batch as DirectDebitBatch
        })
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
        reporter: ({ failed, counterexample, errorInstance }) => {
          if (failed) {
            throw new Error(
              `Property failed after ${runCount} runs.\n` +
                `Last failures:\n${failures.slice(-3).join('\n---\n')}\n` +
                `Counterexample: ${JSON.stringify(counterexample, (_, v) =>
                  typeof v === 'bigint' ? v.toString() + 'n' : v
                )}\n` +
                (errorInstance ? `Error: ${errorInstance}` : '')
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
        reporter: ({ failed, counterexample, errorInstance }) => {
          if (failed) {
            throw new Error(
              `Property failed after ${runCount} runs.\n` +
                `Last failures:\n${failures.slice(-3).join('\n---\n')}\n` +
                `Counterexample: ${JSON.stringify(counterexample, (_, v) =>
                  typeof v === 'bigint' ? v.toString() + 'n' : v
                )}\n` +
                (errorInstance ? `Error: ${errorInstance}` : '')
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
