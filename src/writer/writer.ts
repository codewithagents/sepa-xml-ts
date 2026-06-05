/**
 * XML writer for pain.001 credit transfer documents.
 *
 * Supported output variants:
 * - pain.001.001.09 (default): urn:iso:std:iso:20022:tech:xsd:pain.001.001.09
 * - pain.001.001.03 (legacy ISO): urn:iso:std:iso:20022:tech:xsd:pain.001.001.03
 * - pain.001.003.03 (German DK): urn:iso:std:iso:20022:tech:xsd:pain.001.003.03
 *
 * Design invariants:
 * - Validates the model before writing (throws on invalid input)
 * - CtrlSum uses exact bigint arithmetic, never floating-point
 * - All string values are XML-escaped (SEPA charset enforced by the schema)
 * - pain.001.001.09: ReqdExctnDt is emitted as Dt (date only), never DtTm
 * - pain.001.001.03: ReqdExctnDt is a plain ISODate (no Dt wrapper, per .03 XSD)
 * - pain.001.001.03: FinInstnId uses BIC element (not BICFI, per FinancialInstitutionIdentification7)
 * - pain.001.001.03: DbtrAgt required; emits empty FinInstnId when no BIC (all children optional in XSD)
 * - pain.001.001.03: CdtrAgt is optional; omitted when creditor.bic is absent
 * - pain.001.003.03: ReqdExctnDt is a plain ISODate (no Dt wrapper)
 * - pain.001.003.03: FinInstnId uses BIC element (not BICFI)
 * - pain.001.003.03: DbtrAgt is required; emits NOTPROVIDED when no BIC is set
 * - PmtTpInf/SvcLvl/Cd=SEPA is emitted in each PmtInf (SEPA rulebook requirement)
 * - ChrgBr=SLEV is emitted in each PmtInf (SEPA rulebook requirement)
 * - RmtInf/Ustrd is emitted when remittanceInfo is present on a Transfer
 */

import { CreditTransferDocumentSchema, type CreditTransferDocument } from '../model/schema.js'
import { sumMoney } from '../model/amount.js'
import {
  xe,
  computeTotals,
  emitGrpHdr,
  emitPmtInfHeader,
  emitSvcLvl,
  emitPartyWithAddress,
  emitPartyWithAddressDK,
  emitIbanAcct,
  emitAlwaysFinInstnId,
  emitDkFinInstnId,
  emitIso03FinInstnId,
  emitRmtInf,
  emitStructuredRmtInf,
  emitUltimateParty,
  emitPurp,
  emitCtgyPurp,
  emitCdtTrfTxInfHeader,
} from './xml-emit.js'
import type { BankProfile } from '../profile/profile.js'
import type { CreditTransferVariant } from '../message-types.js'

export type { CreditTransferVariant }

/** Options accepted by writeCreditTransfer. */
export interface WriteCreditTransferOptions {
  /**
   * The output schema variant. Defaults to 'pain.001.001.09'.
   * - 'pain.001.001.03': the legacy ISO credit transfer format, for systems that still require
   *   the older wire format. Uses plain ReqdExctnDt (no Dt wrapper), BIC element (not BICFI),
   *   and empty FinInstnId fallback for DbtrAgt when no BIC is set. XSD-verified against
   *   schemas/iso20022/pain.001.001.03.xsd.
   * - 'pain.001.003.03': the German DK national variant, which uses a different namespace and
   *   structural shape (plain ReqdExctnDt, BIC not BICFI, NOTPROVIDED fallback for DbtrAgt).
   * The model input is the same CreditTransferDocument for all variants.
   */
  variant?: CreditTransferVariant
  /**
   * A bank profile to apply. After base validation, the profile's
   * checkCreditTransfer is run; if it returns any issues, an Error is thrown
   * and no XML is emitted. Profile output options (e.g. batchBooking) are
   * applied to every PmtInf block.
   */
  profile?: BankProfile
}

const XMLNS_09 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09'
const XMLNS_03 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03'
const XMLNS_DK = 'urn:iso:std:iso:20022:tech:xsd:pain.001.003.03'

// Keep the old constant name as an alias to avoid changing the serialization path below.
const XMLNS = XMLNS_09

/**
 * Write a SEPA credit transfer document to an XML string.
 *
 * By default (no variant or variant='pain.001.001.09') this produces a
 * pain.001.001.09 document (the modern SEPA SCT schema). Pass
 * variant='pain.001.003.03' to emit the German DK national variant instead.
 *
 * The model is validated before writing. If validation fails, an error is thrown
 * with a human-readable description of the issue.
 *
 * If a profile is supplied, its checkCreditTransfer rules are run after base
 * validation. Any profile issues cause an Error to be thrown; no XML is emitted.
 * Profile options (e.g. batchBooking) are applied regardless of which variant is used.
 *
 * @param input the credit transfer document model
 * @param options optional write options (variant, profile)
 * @returns UTF-8 XML string
 * @throws Error if the model fails base validation or a profile check
 */
export function writeCreditTransfer(
  input: CreditTransferDocument,
  options?: WriteCreditTransferOptions
): string {
  // Self-check: validate the model before writing
  const parseResult = CreditTransferDocumentSchema.safeParse(input)
  if (!parseResult.success) {
    const messages = parseResult.error.issues
      .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
      .join('; ')
    throw new Error(`Invalid CreditTransferDocument: ${messages}`)
  }
  const doc = parseResult.data

  // Profile check: run after base validation so the doc is known-good
  const profile = options?.profile
  if (profile?.checkCreditTransfer !== undefined) {
    const issues = profile.checkCreditTransfer(doc)
    if (issues.length > 0) {
      const detail = issues
        .map((iss) => (iss.path !== undefined ? `${iss.path}: ${iss.message}` : iss.message))
        .join('; ')
      throw new Error(`Profile "${profile.id}" check failed: ${detail}`)
    }
  }

  const variant = options?.variant ?? 'pain.001.001.09'

  // Ultimate parties are only supported for pain.001.001.09. Fail loud rather than
  // silently drop ultimate-party data when a legacy or DK variant is selected.
  if (variant !== 'pain.001.001.09') {
    const hasUltimate = doc.batches.some((batch) =>
      batch.transfers.some(
        (tx) => tx.ultimateDebtor !== undefined || tx.ultimateCreditor !== undefined
      )
    )
    if (hasUltimate) {
      throw new Error(`ultimate party is not yet supported for variant ${variant}`)
    }
  }

  // Structured remittance is only supported for pain.001.001.09. Fail loud rather
  // than silently drop structured remittance data when a legacy or DK variant is selected.
  if (variant !== 'pain.001.001.09') {
    const hasStructuredRemittance = doc.batches.some((batch) =>
      batch.transfers.some((tx) => tx.structuredRemittance !== undefined)
    )
    if (hasStructuredRemittance) {
      throw new Error(`structured remittance is not yet supported for variant ${variant}`)
    }
  }

  // Purpose codes (Purp and CtgyPurp) are only supported for pain.001.001.09. Fail loud
  // rather than silently drop purpose data when a legacy or DK variant is selected.
  if (variant !== 'pain.001.001.09') {
    const hasPurpose =
      doc.batches.some((batch) => batch.categoryPurpose !== undefined) ||
      doc.batches.some((batch) => batch.transfers.some((tx) => tx.purpose !== undefined))
    if (hasPurpose) {
      throw new Error(
        `purpose codes (purpose, categoryPurpose) are not supported for variant ${variant}`
      )
    }
  }

  if (variant === 'pain.001.001.03') {
    return writeCreditTransfer03(doc, profile)
  }

  if (variant === 'pain.001.003.03') {
    return writeCreditTransferDK(doc, profile)
  }

  return writeCreditTransfer09(doc, profile)
}

// ---------------------------------------------------------------------------
// pain.001.001.09 writer (default, existing behavior)
// ---------------------------------------------------------------------------

function writeCreditTransfer09(
  doc: CreditTransferDocument,
  profile: BankProfile | undefined
): string {
  // Compute NbOfTxs and CtrlSum across all batches
  const allAmounts = doc.batches.flatMap((batch) => batch.transfers.map((tx) => tx.amount))
  const { txCount: totalTxCount, ctrlSum: totalCtrlSum } = computeTotals(allAmounts)

  const lines: string[] = []

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`)
  lines.push(`<Document xmlns="${XMLNS}">`)
  lines.push(`  <CstmrCdtTrfInitn>`)

  // Group Header
  emitGrpHdr(lines, doc.messageId, doc.createdAt, totalTxCount, totalCtrlSum, doc.initiatingParty)

  // Payment Batches (PmtInf)
  for (const batch of doc.batches) {
    const batchAmounts = batch.transfers.map((tx) => tx.amount)
    const batchNbOfTxs = batchAmounts.length
    const batchCtrlSum = sumMoney(batchAmounts)

    emitPmtInfHeader(
      lines,
      batch.id,
      'TRF',
      batchNbOfTxs,
      batchCtrlSum,
      profile?.output?.batchBooking
    )
    // PmtTpInf/SvcLvl/Cd=SEPA: SEPA rulebook requirement (XSD position: after CtrlSum, before ReqdExctnDt)
    // PaymentTypeInformation26 child order: InstrPrty, SvcLvl, LclInstrm, CtgyPurp (LAST)
    lines.push(`      <PmtTpInf>`)
    emitSvcLvl(lines)
    // CtgyPurp is the last child of PmtTpInf (PaymentTypeInformation26)
    emitCtgyPurp(lines, batch.categoryPurpose)
    lines.push(`      </PmtTpInf>`)
    lines.push(`      <ReqdExctnDt>`)
    lines.push(`        <Dt>${xe(batch.executionDate)}</Dt>`)
    lines.push(`      </ReqdExctnDt>`)
    emitPartyWithAddress(lines, '      ', 'Dbtr', batch.debtor.name, batch.debtor.address)
    emitIbanAcct(lines, '      ', 'DbtrAcct', batch.debtor.iban)
    emitAlwaysFinInstnId(lines, '      ', 'DbtrAgt', batch.debtor.bic)
    // ChrgBr=SLEV: SEPA rulebook requirement (XSD position: after DbtrAgt, before CdtTrfTxInf)
    lines.push(`      <ChrgBr>SLEV</ChrgBr>`)

    // Credit Transfer Transactions
    for (const tx of batch.transfers) {
      emitCdtTrfTxInfHeader(lines, tx.endToEndId, tx.amount)
      // UltmtDbtr: XSD position after Amt (after ChqInstr), before IntrmyAgt1/CdtrAgt (CreditTransferTransaction34 sequence)
      emitUltimateParty(lines, '        ', 'UltmtDbtr', tx.ultimateDebtor)
      if (tx.creditor.bic !== undefined) {
        lines.push(`        <CdtrAgt>`)
        lines.push(`          <FinInstnId>`)
        lines.push(`            <BICFI>${xe(tx.creditor.bic)}</BICFI>`)
        lines.push(`          </FinInstnId>`)
        lines.push(`        </CdtrAgt>`)
      }
      emitPartyWithAddress(lines, '        ', 'Cdtr', tx.creditor.name, tx.creditor.address)
      emitIbanAcct(lines, '        ', 'CdtrAcct', tx.creditor.iban)
      // UltmtCdtr: XSD position after CdtrAcct, before InstrForCdtrAgt/Purp/RmtInf (CreditTransferTransaction34 sequence)
      emitUltimateParty(lines, '        ', 'UltmtCdtr', tx.ultimateCreditor)
      // Purp: XSD position after InstrForDbtrAgt, before RgltryRptg/Tax/RmtInf (CreditTransferTransaction34 sequence)
      // In our writer this is after UltmtCdtr, before RmtInf (we do not emit the intervening optional elements)
      emitPurp(lines, tx.purpose)
      // Emit either unstructured or structured remittance (never both, enforced by model validation)
      if (tx.structuredRemittance !== undefined) {
        emitStructuredRmtInf(lines, tx.structuredRemittance)
      } else {
        emitRmtInf(lines, tx.remittanceInfo)
      }
      lines.push(`      </CdtTrfTxInf>`)
    }

    lines.push(`    </PmtInf>`)
  }

  lines.push(`  </CstmrCdtTrfInitn>`)
  lines.push(`</Document>`)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// pain.001.001.03 writer (legacy ISO format)
//
// Structural deltas vs pain.001.001.09 (derived from schemas/iso20022/pain.001.001.03.xsd):
// 1. Namespace: urn:iso:std:iso:20022:tech:xsd:pain.001.001.03
// 2. ReqdExctnDt is a plain ISODate (no DateAndDateTime2Choice, no <Dt> wrapper).
//    XSD: PaymentInstructionInformation3/ReqdExctnDt type ISODate.
// 3. FinInstnId uses <BIC> element (not <BICFI>).
//    XSD: FinancialInstitutionIdentification7 has optional <BIC type="BICIdentifier">.
// 4. DbtrAgt (PmtInf level) is REQUIRED (no minOccurs=0 in PaymentInstructionInformation3).
//    When debtor.bic is absent, emits <DbtrAgt><FinInstnId/></DbtrAgt> (empty FinInstnId
//    is valid because all FinancialInstitutionIdentification7 children are optional).
// 5. CdtrAgt (CdtTrfTxInf level) is OPTIONAL (minOccurs=0). Omitted when creditor.bic absent.
//    This matches pain.001.001.09 behavior.
// ---------------------------------------------------------------------------

function writeCreditTransfer03(
  doc: CreditTransferDocument,
  profile: BankProfile | undefined
): string {
  // Compute NbOfTxs and CtrlSum across all batches
  const allAmounts = doc.batches.flatMap((batch) => batch.transfers.map((tx) => tx.amount))
  const { txCount: totalTxCount, ctrlSum: totalCtrlSum } = computeTotals(allAmounts)

  const lines: string[] = []

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`)
  lines.push(`<Document xmlns="${XMLNS_03}">`)
  lines.push(`  <CstmrCdtTrfInitn>`)

  // Group Header (same structure as .09)
  emitGrpHdr(lines, doc.messageId, doc.createdAt, totalTxCount, totalCtrlSum, doc.initiatingParty)

  // Payment Batches (PmtInf)
  for (const batch of doc.batches) {
    const batchAmounts = batch.transfers.map((tx) => tx.amount)
    const batchNbOfTxs = batchAmounts.length
    const batchCtrlSum = sumMoney(batchAmounts)

    emitPmtInfHeader(
      lines,
      batch.id,
      'TRF',
      batchNbOfTxs,
      batchCtrlSum,
      profile?.output?.batchBooking
    )
    // PmtTpInf/SvcLvl/Cd=SEPA: same as .09 (XSD position: after CtrlSum, before ReqdExctnDt)
    lines.push(`      <PmtTpInf>`)
    emitSvcLvl(lines)
    lines.push(`      </PmtTpInf>`)
    // Delta 1: ReqdExctnDt is a plain ISODate (no <Dt> wrapper)
    lines.push(`      <ReqdExctnDt>${xe(batch.executionDate)}</ReqdExctnDt>`)
    // PostalAddress6 (pain.001.001.03 XSD) supports all our model fields in the same order as PostalAddress24.
    emitPartyWithAddress(lines, '      ', 'Dbtr', batch.debtor.name, batch.debtor.address)
    emitIbanAcct(lines, '      ', 'DbtrAcct', batch.debtor.iban)
    // Delta 2: DbtrAgt required; BIC element (not BICFI); empty FinInstnId when no BIC
    emitIso03FinInstnId(lines, '      ', 'DbtrAgt', batch.debtor.bic, true)
    // ChrgBr=SLEV: SEPA rulebook requirement (XSD position: after DbtrAgt, before CdtTrfTxInf)
    lines.push(`      <ChrgBr>SLEV</ChrgBr>`)

    // Credit Transfer Transactions
    for (const tx of batch.transfers) {
      emitCdtTrfTxInfHeader(lines, tx.endToEndId, tx.amount)
      // Delta 3: CdtrAgt optional; BIC element (not BICFI); omitted when no BIC
      emitIso03FinInstnId(lines, '        ', 'CdtrAgt', tx.creditor.bic, false)
      // PostalAddress6 supports all our model fields.
      emitPartyWithAddress(lines, '        ', 'Cdtr', tx.creditor.name, tx.creditor.address)
      emitIbanAcct(lines, '        ', 'CdtrAcct', tx.creditor.iban)
      emitRmtInf(lines, tx.remittanceInfo)
      lines.push(`      </CdtTrfTxInf>`)
    }

    lines.push(`    </PmtInf>`)
  }

  lines.push(`  </CstmrCdtTrfInitn>`)
  lines.push(`</Document>`)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// pain.001.003.03 writer (German DK national variant)
//
// Structural deltas vs pain.001.001.09:
// 1. Namespace: urn:iso:std:iso:20022:tech:xsd:pain.001.003.03
// 2. ReqdExctnDt is a plain ISODate element, not wrapped in DateAndDateTime2Choice
//    (no <Dt> child; the date string is direct text content of <ReqdExctnDt>)
// 3. FinInstnId uses <BIC> element name, not <BICFI>
// 4. DbtrAgt (PmtInf level) is REQUIRED: when debtor.bic is absent, emits
//    <Othr><Id>NOTPROVIDED</Id></Othr> (the only allowed fallback in the DK XSD)
// 5. CdtrAgt (CdtTrfTxInf level) is OPTIONAL: only emitted when creditor.bic is set
// ---------------------------------------------------------------------------

function writeCreditTransferDK(
  doc: CreditTransferDocument,
  profile: BankProfile | undefined
): string {
  // Compute NbOfTxs and CtrlSum across all batches
  const allAmounts = doc.batches.flatMap((batch) => batch.transfers.map((tx) => tx.amount))
  const { txCount: totalTxCount, ctrlSum: totalCtrlSum } = computeTotals(allAmounts)

  const lines: string[] = []

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`)
  lines.push(`<Document xmlns="${XMLNS_DK}">`)
  lines.push(`  <CstmrCdtTrfInitn>`)

  // Group Header (same structure as .09)
  emitGrpHdr(lines, doc.messageId, doc.createdAt, totalTxCount, totalCtrlSum, doc.initiatingParty)

  // Payment Batches (PmtInf)
  for (const batch of doc.batches) {
    const batchAmounts = batch.transfers.map((tx) => tx.amount)
    const batchNbOfTxs = batchAmounts.length
    const batchCtrlSum = sumMoney(batchAmounts)

    emitPmtInfHeader(
      lines,
      batch.id,
      'TRF',
      batchNbOfTxs,
      batchCtrlSum,
      profile?.output?.batchBooking
    )
    // PmtTpInf/SvcLvl/Cd=SEPA: same as .09 (XSD position: after CtrlSum, before ReqdExctnDt)
    lines.push(`      <PmtTpInf>`)
    emitSvcLvl(lines)
    lines.push(`      </PmtTpInf>`)
    // DK delta 1: ReqdExctnDt is a plain ISODate (no <Dt> wrapper)
    lines.push(`      <ReqdExctnDt>${xe(batch.executionDate)}</ReqdExctnDt>`)
    // PostalAddressSEPA (DK XSD) only allows Ctry and AdrLine (max 2).
    // emitPartyWithAddressDK throws on any unsupported field.
    emitPartyWithAddressDK(
      lines,
      '      ',
      'Dbtr',
      batch.debtor.name,
      batch.debtor.address,
      'pain.001.003.03'
    )
    emitIbanAcct(lines, '      ', 'DbtrAcct', batch.debtor.iban)
    // DK delta 2: DbtrAgt is required; uses BIC element (not BICFI); falls back to NOTPROVIDED
    emitDkFinInstnId(lines, '      ', 'DbtrAgt', batch.debtor.bic, true)
    // ChrgBr=SLEV: SEPA rulebook requirement (XSD position: after DbtrAgt, before CdtTrfTxInf)
    lines.push(`      <ChrgBr>SLEV</ChrgBr>`)

    // Credit Transfer Transactions
    for (const tx of batch.transfers) {
      emitCdtTrfTxInfHeader(lines, tx.endToEndId, tx.amount)
      // DK delta 3: CdtrAgt is optional; uses BIC element (not BICFI); omitted when no BIC
      emitDkFinInstnId(lines, '        ', 'CdtrAgt', tx.creditor.bic, false)
      // PostalAddressSEPA: only Ctry + AdrLine (max 2) supported.
      emitPartyWithAddressDK(
        lines,
        '        ',
        'Cdtr',
        tx.creditor.name,
        tx.creditor.address,
        'pain.001.003.03'
      )
      emitIbanAcct(lines, '        ', 'CdtrAcct', tx.creditor.iban)
      emitRmtInf(lines, tx.remittanceInfo)
      lines.push(`      </CdtTrfTxInf>`)
    }

    lines.push(`    </PmtInf>`)
  }

  lines.push(`  </CstmrCdtTrfInitn>`)
  lines.push(`</Document>`)

  return lines.join('\n')
}
