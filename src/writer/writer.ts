/**
 * XML writer for pain.001.001.09 (CustomerCreditTransferInitiation).
 *
 * Produces a UTF-8 XML string conforming to:
 * urn:iso:std:iso:20022:tech:xsd:pain.001.001.09
 *
 * Design invariants:
 * - Validates the model before writing (throws on invalid input)
 * - CtrlSum uses exact bigint arithmetic, never floating-point
 * - All string values are XML-escaped (SEPA charset enforced by the schema)
 * - ReqdExctnDt is emitted as Dt (date only), never DtTm
 * - PmtTpInf/SvcLvl/Cd=SEPA is emitted in each PmtInf (SEPA rulebook requirement)
 * - ChrgBr=SLEV is emitted in each PmtInf (SEPA rulebook requirement)
 * - RmtInf/Ustrd is emitted when remittanceInfo is present on a Transfer
 */

import { CreditTransferDocumentSchema, type CreditTransferDocument } from '../model/schema.js'
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

/** Options accepted by writeCreditTransfer. */
export interface WriteCreditTransferOptions {
  /**
   * A bank profile to apply. After base validation, the profile's
   * checkCreditTransfer is run; if it returns any issues, an Error is thrown
   * and no XML is emitted. Profile output options (e.g. batchBooking) are
   * applied to every PmtInf block.
   */
  profile?: BankProfile
}

const XMLNS = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09'

/**
 * Write a pain.001.001.09 credit transfer document to an XML string.
 *
 * The model is validated before writing. If validation fails, an error is thrown
 * with a human-readable description of the issue.
 *
 * If a profile is supplied, its checkCreditTransfer rules are run after base
 * validation. Any profile issues cause an Error to be thrown; no XML is emitted.
 *
 * @param input the credit transfer document model
 * @param options optional write options (profile)
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
    lines.push(`      <PmtTpInf>`)
    emitSvcLvl(lines)
    lines.push(`      </PmtTpInf>`)
    lines.push(`      <ReqdExctnDt>`)
    lines.push(`        <Dt>${xe(batch.executionDate)}</Dt>`)
    lines.push(`      </ReqdExctnDt>`)
    emitNmElement(lines, '      ', 'Dbtr', batch.debtor.name)
    emitIbanAcct(lines, '      ', 'DbtrAcct', batch.debtor.iban)
    emitAlwaysFinInstnId(lines, '      ', 'DbtrAgt', batch.debtor.bic)
    // ChrgBr=SLEV: SEPA rulebook requirement (XSD position: after DbtrAgt, before CdtTrfTxInf)
    lines.push(`      <ChrgBr>SLEV</ChrgBr>`)

    // Credit Transfer Transactions
    for (const tx of batch.transfers) {
      lines.push(`      <CdtTrfTxInf>`)
      lines.push(`        <PmtId>`)
      lines.push(`          <EndToEndId>${xe(tx.endToEndId)}</EndToEndId>`)
      lines.push(`        </PmtId>`)
      lines.push(`        <Amt>`)
      lines.push(`          <InstdAmt Ccy="EUR">${formatAmountForXml(tx.amount)}</InstdAmt>`)
      lines.push(`        </Amt>`)
      if (tx.creditor.bic !== undefined) {
        lines.push(`        <CdtrAgt>`)
        lines.push(`          <FinInstnId>`)
        lines.push(`            <BICFI>${xe(tx.creditor.bic)}</BICFI>`)
        lines.push(`          </FinInstnId>`)
        lines.push(`        </CdtrAgt>`)
      }
      emitNmElement(lines, '        ', 'Cdtr', tx.creditor.name)
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
