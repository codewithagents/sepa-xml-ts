/**
 * XML writer for pain.008.001.08 (CustomerDirectDebitInitiation).
 *
 * Produces a UTF-8 XML string conforming to:
 * urn:iso:std:iso:20022:tech:xsd:pain.008.001.08
 *
 * Design invariants:
 * - Validates the model before writing (throws on invalid input)
 * - CtrlSum uses exact bigint arithmetic, never floating-point
 * - All string values are XML-escaped (SEPA charset enforced by the schema)
 * - ReqdColltnDt is a date (not datetime)
 * - CdtrAgt is emitted in every PmtInf (required by XSD; empty FinInstnId when no BIC)
 * - DbtrAgt is emitted in every DrctDbtTxInf (required by XSD; empty FinInstnId when no BIC)
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
  emitPmtInfHeader,
  emitSvcLvl,
  emitNmElement,
  emitIbanAcct,
  emitAlwaysFinInstnId,
  emitRmtInf,
} from './xml-emit.js'
import type { BankProfile } from '../profile/profile.js'

/** Options accepted by writeDirectDebit. */
export interface WriteDirectDebitOptions {
  /**
   * A bank profile to apply. After base validation, the profile's
   * checkDirectDebit is run; if it returns any issues, an Error is thrown
   * and no XML is emitted. Profile output options (e.g. batchBooking) are
   * applied to every PmtInf block.
   */
  profile?: BankProfile
}

const XMLNS = 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.08'

/**
 * Write a pain.008.001.08 direct debit document to an XML string.
 *
 * The model is validated before writing. If validation fails, an error is thrown
 * with a human-readable description of the issue.
 *
 * If a profile is supplied, its checkDirectDebit rules are run after base
 * validation. Any profile issues cause an Error to be thrown; no XML is emitted.
 *
 * @param input the direct debit document model
 * @param options optional write options (profile)
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
