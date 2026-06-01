/**
 * XML writer for pain.008.001.08 (CustomerDirectDebitInitiation) and the
 * German DK national variant pain.008.003.02.
 *
 * Produces a UTF-8 XML string conforming to the selected schema:
 * - pain.008.001.08 (default): urn:iso:std:iso:20022:tech:xsd:pain.008.001.08
 * - pain.008.003.02 (DK variant): urn:iso:std:iso:20022:tech:xsd:pain.008.003.02
 *
 * Design invariants:
 * - Validates the model before writing (throws on invalid input)
 * - CtrlSum uses exact bigint arithmetic, never floating-point
 * - All string values are XML-escaped (SEPA charset enforced by the schema)
 * - ReqdColltnDt is a date (not datetime)
 * - pain.008.001.08: CdtrAgt emits empty FinInstnId when no BIC
 * - pain.008.001.08: DbtrAgt emits empty FinInstnId when no BIC
 * - pain.008.003.02: FinInstnId uses BIC element (not BICFI); NOTPROVIDED when BIC absent
 * - pain.008.003.02: GrpHdr omits CtrlSum (optional in the DK XSD; reference sample omits it)
 * - CdtrSchmeId is at PmtInf level (standard SEPA practice); writer fans it out from doc.creditor
 * - PmtTpInf/SvcLvl/Cd=SEPA and SeqTp are emitted in each PmtInf
 * - ChrgBr=SLEV is emitted at PmtInf level (SEPA requirement)
 * - RmtInf/Ustrd is emitted when remittanceInfo is present
 */

import { DirectDebitDocumentSchema, type DirectDebitDocument } from '../model/pain008.js'
import { formatAmountForXml, sumMoney } from '../model/amount.js'
import {
  xe,
  computeTotals,
  emitGrpHdr,
  emitGrpHdrNoCtrlSum,
  emitPmtInfHeader,
  emitSvcLvl,
  emitNmElement,
  emitIbanAcct,
  emitAlwaysFinInstnId,
  emitDkFinInstnId,
  emitRmtInf,
} from './xml-emit.js'
import type { BankProfile } from '../profile/profile.js'
import { checkDirectDebitRules } from '../model/dd-rules.js'

/**
 * The output schema variant for writeDirectDebit.
 * - 'pain.008.001.08': the modern SEPA SDD schema (default, unchanged behavior)
 * - 'pain.008.003.02': the German DK national variant (different namespace and structure)
 */
export type DirectDebitVariant = 'pain.008.001.08' | 'pain.008.003.02'

/** Options accepted by writeDirectDebit. */
export interface WriteDirectDebitOptions {
  /**
   * The output schema variant. Defaults to 'pain.008.001.08'.
   * Use 'pain.008.003.02' to emit the German DK national variant, which uses a
   * different namespace and structural shape (BIC not BICFI, NOTPROVIDED fallback,
   * GrpHdr without CtrlSum). The model input is the same for both variants.
   */
  variant?: DirectDebitVariant
  /**
   * A bank profile to apply. After base validation, the profile's
   * checkDirectDebit is run; if it returns any issues, an Error is thrown
   * and no XML is emitted. Profile output options (e.g. batchBooking) are
   * applied to every PmtInf block.
   */
  profile?: BankProfile
}

const XMLNS_08 = 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.08'
const XMLNS_DK = 'urn:iso:std:iso:20022:tech:xsd:pain.008.003.02'

// Keep the old constant name as an alias to avoid changing the serialization path below.
const XMLNS = XMLNS_08

/**
 * Write a SEPA direct debit document to an XML string.
 *
 * By default (no variant or variant='pain.008.001.08') this produces a
 * pain.008.001.08 document (the modern SEPA SDD schema). Pass
 * variant='pain.008.003.02' to emit the German DK national variant instead.
 *
 * The model is validated before writing. If validation fails, an error is thrown
 * with a human-readable description of the issue.
 *
 * If a profile is supplied, its checkDirectDebit rules are run after base
 * validation. Any profile issues cause an Error to be thrown; no XML is emitted.
 * Profile options (e.g. batchBooking) are applied regardless of which variant is used.
 *
 * @param input the direct debit document model
 * @param options optional write options (variant, profile)
 * @returns UTF-8 XML string
 * @throws Error if the model fails base validation or a profile check
 */
export function writeDirectDebit(
  input: DirectDebitDocument,
  options?: WriteDirectDebitOptions
): string {
  // Self-check: validate the model before writing
  const parseResult = DirectDebitDocumentSchema.safeParse(input)
  if (!parseResult.success) {
    const messages = parseResult.error.issues
      .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
      .join('; ')
    throw new Error(`Invalid DirectDebitDocument: ${messages}`)
  }
  const doc = parseResult.data

  // Cross-field SEPA rulebook checks (R1 signature<=collection, R2 OOFF single-use, R3 consistent scheme).
  // Applies to both pain.008.001.08 and pain.008.003.02 since the shared entry point validates before dispatch.
  const ruleIssues = checkDirectDebitRules(doc)
  if (ruleIssues.length > 0) {
    const detail = ruleIssues
      .map((iss) => (iss.path !== undefined ? `${iss.path}: ${iss.message}` : iss.message))
      .join('; ')
    throw new Error(`DirectDebitDocument violates SEPA rules: ${detail}`)
  }

  // Profile check: run after base validation so the doc is known-good
  const profile = options?.profile
  if (profile?.checkDirectDebit !== undefined) {
    const issues = profile.checkDirectDebit(doc)
    if (issues.length > 0) {
      const detail = issues
        .map((iss) => (iss.path !== undefined ? `${iss.path}: ${iss.message}` : iss.message))
        .join('; ')
      throw new Error(`Profile "${profile.id}" check failed: ${detail}`)
    }
  }

  const variant = options?.variant ?? 'pain.008.001.08'

  if (variant === 'pain.008.003.02') {
    return writeDirectDebitDK(doc, profile)
  }

  return writeDirectDebit08(doc, profile)
}

// ---------------------------------------------------------------------------
// pain.008.001.08 writer (default, existing behavior)
// ---------------------------------------------------------------------------

function writeDirectDebit08(doc: DirectDebitDocument, profile: BankProfile | undefined): string {
  // Compute NbOfTxs and CtrlSum across all batches
  const allAmounts = doc.batches.flatMap((batch) => batch.collections.map((col) => col.amount))
  const { txCount: totalTxCount, ctrlSum: totalCtrlSum } = computeTotals(allAmounts)

  const lines: string[] = []

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`)
  lines.push(`<Document xmlns="${XMLNS}">`)
  lines.push(`  <CstmrDrctDbtInitn>`)

  // Group Header
  emitGrpHdr(lines, doc.messageId, doc.createdAt, totalTxCount, totalCtrlSum, doc.initiatingParty)

  // Payment Batches (PmtInf)
  for (const batch of doc.batches) {
    const batchAmounts = batch.collections.map((col) => col.amount)
    const batchNbOfTxs = batchAmounts.length
    const batchCtrlSum = sumMoney(batchAmounts)
    const localInstrument = batch.localInstrument ?? 'CORE'

    emitPmtInfHeader(
      lines,
      batch.id,
      'DD',
      batchNbOfTxs,
      batchCtrlSum,
      profile?.output?.batchBooking
    )
    lines.push(`      <PmtTpInf>`)
    emitSvcLvl(lines)
    lines.push(`        <LclInstrm>`)
    lines.push(`          <Cd>${localInstrument}</Cd>`)
    lines.push(`        </LclInstrm>`)
    lines.push(`        <SeqTp>${batch.sequenceType}</SeqTp>`)
    lines.push(`      </PmtTpInf>`)
    lines.push(`      <ReqdColltnDt>${xe(batch.collectionDate)}</ReqdColltnDt>`)

    // Creditor (fans out doc-level creditor into each PmtInf)
    emitNmElement(lines, '      ', 'Cdtr', doc.creditor.name)
    emitIbanAcct(lines, '      ', 'CdtrAcct', doc.creditor.iban)
    // CdtrAgt is required in XSD (PaymentInstruction29); emit empty FinInstnId when no BIC
    emitAlwaysFinInstnId(lines, '      ', 'CdtrAgt', doc.creditor.bic)
    // ChrgBr=SLEV is standard SEPA practice
    lines.push(`      <ChrgBr>SLEV</ChrgBr>`)
    // CdtrSchmeId: SEPA Creditor Identifier at PmtInf level
    lines.push(`      <CdtrSchmeId>`)
    lines.push(`        <Id>`)
    lines.push(`          <PrvtId>`)
    lines.push(`            <Othr>`)
    lines.push(`              <Id>${xe(doc.creditor.creditorId)}</Id>`)
    lines.push(`              <SchmeNm>`)
    lines.push(`                <Prtry>SEPA</Prtry>`)
    lines.push(`              </SchmeNm>`)
    lines.push(`            </Othr>`)
    lines.push(`          </PrvtId>`)
    lines.push(`        </Id>`)
    lines.push(`      </CdtrSchmeId>`)

    // Direct Debit Transaction Information (DrctDbtTxInf)
    for (const col of batch.collections) {
      lines.push(`      <DrctDbtTxInf>`)
      lines.push(`        <PmtId>`)
      lines.push(`          <EndToEndId>${xe(col.endToEndId)}</EndToEndId>`)
      lines.push(`        </PmtId>`)
      lines.push(`        <InstdAmt Ccy="EUR">${formatAmountForXml(col.amount)}</InstdAmt>`)
      lines.push(`        <DrctDbtTx>`)
      lines.push(`          <MndtRltdInf>`)
      lines.push(`            <MndtId>${xe(col.mandate.id)}</MndtId>`)
      lines.push(`            <DtOfSgntr>${xe(col.mandate.signatureDate)}</DtOfSgntr>`)
      lines.push(`          </MndtRltdInf>`)
      lines.push(`        </DrctDbtTx>`)
      // DbtrAgt is required in XSD (DirectDebitTransactionInformation23)
      emitAlwaysFinInstnId(lines, '        ', 'DbtrAgt', col.debtor.bic)
      emitNmElement(lines, '        ', 'Dbtr', col.debtor.name)
      emitIbanAcct(lines, '        ', 'DbtrAcct', col.debtor.iban)
      emitRmtInf(lines, col.remittanceInfo)
      lines.push(`      </DrctDbtTxInf>`)
    }

    lines.push(`    </PmtInf>`)
  }

  lines.push(`  </CstmrDrctDbtInitn>`)
  lines.push(`</Document>`)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// pain.008.003.02 writer (German DK national variant)
//
// Structural deltas vs pain.008.001.08:
// 1. Namespace: urn:iso:std:iso:20022:tech:xsd:pain.008.003.02
// 2. GrpHdr omits CtrlSum (optional in GroupHeaderSDD of the DK XSD; reference sample omits it)
// 3. FinInstnId uses <BIC> element name (not <BICFI>)
// 4. CdtrAgt (PmtInf level) uses BIC or Othr/NOTPROVIDED (BranchAndFinancialInstitutionIdentificationSEPA3)
// 5. DbtrAgt (DrctDbtTxInf level) uses BIC or Othr/NOTPROVIDED (BranchAndFinancialInstitutionIdentificationSEPA3)
// ---------------------------------------------------------------------------

function writeDirectDebitDK(doc: DirectDebitDocument, profile: BankProfile | undefined): string {
  // Compute NbOfTxs across all batches (CtrlSum is omitted from GrpHdr in the DK variant)
  const allAmounts = doc.batches.flatMap((batch) => batch.collections.map((col) => col.amount))
  const { txCount: totalTxCount } = computeTotals(allAmounts)

  const lines: string[] = []

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`)
  lines.push(`<Document xmlns="${XMLNS_DK}">`)
  lines.push(`  <CstmrDrctDbtInitn>`)

  // DK delta 1: GrpHdr without CtrlSum (optional in the DK XSD; reference sample omits it)
  emitGrpHdrNoCtrlSum(lines, doc.messageId, doc.createdAt, totalTxCount, doc.initiatingParty)

  // Payment Batches (PmtInf)
  for (const batch of doc.batches) {
    const batchAmounts = batch.collections.map((col) => col.amount)
    const batchNbOfTxs = batchAmounts.length
    const batchCtrlSum = sumMoney(batchAmounts)
    const localInstrument = batch.localInstrument ?? 'CORE'

    emitPmtInfHeader(
      lines,
      batch.id,
      'DD',
      batchNbOfTxs,
      batchCtrlSum,
      profile?.output?.batchBooking
    )
    lines.push(`      <PmtTpInf>`)
    emitSvcLvl(lines)
    lines.push(`        <LclInstrm>`)
    lines.push(`          <Cd>${localInstrument}</Cd>`)
    lines.push(`        </LclInstrm>`)
    lines.push(`        <SeqTp>${batch.sequenceType}</SeqTp>`)
    lines.push(`      </PmtTpInf>`)
    lines.push(`      <ReqdColltnDt>${xe(batch.collectionDate)}</ReqdColltnDt>`)

    // Creditor (fans out doc-level creditor into each PmtInf)
    emitNmElement(lines, '      ', 'Cdtr', doc.creditor.name)
    emitIbanAcct(lines, '      ', 'CdtrAcct', doc.creditor.iban)
    // DK delta 2: CdtrAgt uses BIC or NOTPROVIDED (BranchAndFinancialInstitutionIdentificationSEPA3)
    emitDkFinInstnId(lines, '      ', 'CdtrAgt', doc.creditor.bic, true)
    // ChrgBr=SLEV: standard SEPA practice (optional in .003.02 XSD, recommended at PmtInf level)
    lines.push(`      <ChrgBr>SLEV</ChrgBr>`)
    // CdtrSchmeId: SEPA Creditor Identifier at PmtInf level (same structure as .08)
    lines.push(`      <CdtrSchmeId>`)
    lines.push(`        <Id>`)
    lines.push(`          <PrvtId>`)
    lines.push(`            <Othr>`)
    lines.push(`              <Id>${xe(doc.creditor.creditorId)}</Id>`)
    lines.push(`              <SchmeNm>`)
    lines.push(`                <Prtry>SEPA</Prtry>`)
    lines.push(`              </SchmeNm>`)
    lines.push(`            </Othr>`)
    lines.push(`          </PrvtId>`)
    lines.push(`        </Id>`)
    lines.push(`      </CdtrSchmeId>`)

    // Direct Debit Transaction Information (DrctDbtTxInf)
    for (const col of batch.collections) {
      lines.push(`      <DrctDbtTxInf>`)
      lines.push(`        <PmtId>`)
      lines.push(`          <EndToEndId>${xe(col.endToEndId)}</EndToEndId>`)
      lines.push(`        </PmtId>`)
      lines.push(`        <InstdAmt Ccy="EUR">${formatAmountForXml(col.amount)}</InstdAmt>`)
      lines.push(`        <DrctDbtTx>`)
      lines.push(`          <MndtRltdInf>`)
      lines.push(`            <MndtId>${xe(col.mandate.id)}</MndtId>`)
      lines.push(`            <DtOfSgntr>${xe(col.mandate.signatureDate)}</DtOfSgntr>`)
      lines.push(`          </MndtRltdInf>`)
      lines.push(`        </DrctDbtTx>`)
      // DK delta 3: DbtrAgt uses BIC or NOTPROVIDED (BranchAndFinancialInstitutionIdentificationSEPA3)
      emitDkFinInstnId(lines, '        ', 'DbtrAgt', col.debtor.bic, true)
      emitNmElement(lines, '        ', 'Dbtr', col.debtor.name)
      emitIbanAcct(lines, '        ', 'DbtrAcct', col.debtor.iban)
      emitRmtInf(lines, col.remittanceInfo)
      lines.push(`      </DrctDbtTxInf>`)
    }

    lines.push(`    </PmtInf>`)
  }

  lines.push(`  </CstmrDrctDbtInitn>`)
  lines.push(`</Document>`)

  return lines.join('\n')
}
