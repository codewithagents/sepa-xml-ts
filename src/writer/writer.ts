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
import { escapeXml } from '../model/charset.js'
import { formatAmountForXml, sumMoney } from '../model/amount.js'

const XMLNS = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09'

/** Escapes a value for use in XML text content. */
function xe(value: string): string {
  return escapeXml(value)
}

/**
 * Write a pain.001.001.09 credit transfer document to an XML string.
 *
 * The model is validated before writing. If validation fails, an error is thrown
 * with a human-readable description of the issue.
 *
 * @param input the credit transfer document model
 * @returns UTF-8 XML string
 * @throws Error if the model fails validation
 */
export function writeCreditTransfer(input: CreditTransferDocument): string {
  // Self-check: validate the model before writing
  const parseResult = CreditTransferDocumentSchema.safeParse(input)
  if (!parseResult.success) {
    const messages = parseResult.error.issues
      .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
      .join('; ')
    throw new Error(`Invalid CreditTransferDocument: ${messages}`)
  }
  const doc = parseResult.data

  // Compute NbOfTxs and CtrlSum across all batches
  const allAmounts = doc.batches.flatMap((batch) => batch.transfers.map((tx) => tx.amount))
  const totalTxCount = allAmounts.length
  const totalCtrlSum = sumMoney(allAmounts)

  const lines: string[] = []

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`)
  lines.push(`<Document xmlns="${XMLNS}">`)
  lines.push(`  <CstmrCdtTrfInitn>`)

  // Group Header
  lines.push(`    <GrpHdr>`)
  lines.push(`      <MsgId>${xe(doc.messageId)}</MsgId>`)
  lines.push(`      <CreDtTm>${xe(doc.createdAt)}</CreDtTm>`)
  lines.push(`      <NbOfTxs>${totalTxCount}</NbOfTxs>`)
  lines.push(
    `      <CtrlSum>${formatAmountForXml({ currencyCode: 'EUR', minorUnits: totalCtrlSum })}</CtrlSum>`
  )
  lines.push(`      <InitgPty>`)
  lines.push(`        <Nm>${xe(doc.initiatingParty)}</Nm>`)
  lines.push(`      </InitgPty>`)
  lines.push(`    </GrpHdr>`)

  // Payment Batches (PmtInf)
  for (const batch of doc.batches) {
    const batchAmounts = batch.transfers.map((tx) => tx.amount)
    const batchNbOfTxs = batchAmounts.length
    const batchCtrlSum = sumMoney(batchAmounts)

    lines.push(`    <PmtInf>`)
    lines.push(`      <PmtInfId>${xe(batch.id)}</PmtInfId>`)
    lines.push(`      <PmtMtd>TRF</PmtMtd>`)
    lines.push(`      <NbOfTxs>${batchNbOfTxs}</NbOfTxs>`)
    lines.push(
      `      <CtrlSum>${formatAmountForXml({ currencyCode: 'EUR', minorUnits: batchCtrlSum })}</CtrlSum>`
    )
    // PmtTpInf/SvcLvl/Cd=SEPA: SEPA rulebook requirement (XSD position: after CtrlSum, before ReqdExctnDt)
    lines.push(`      <PmtTpInf>`)
    lines.push(`        <SvcLvl>`)
    lines.push(`          <Cd>SEPA</Cd>`)
    lines.push(`        </SvcLvl>`)
    lines.push(`      </PmtTpInf>`)
    lines.push(`      <ReqdExctnDt>`)
    lines.push(`        <Dt>${xe(batch.executionDate)}</Dt>`)
    lines.push(`      </ReqdExctnDt>`)
    lines.push(`      <Dbtr>`)
    lines.push(`        <Nm>${xe(batch.debtor.name)}</Nm>`)
    lines.push(`      </Dbtr>`)
    lines.push(`      <DbtrAcct>`)
    lines.push(`        <Id>`)
    lines.push(`          <IBAN>${xe(batch.debtor.iban)}</IBAN>`)
    lines.push(`        </Id>`)
    lines.push(`      </DbtrAcct>`)
    lines.push(`      <DbtrAgt>`)
    lines.push(`        <FinInstnId>`)
    if (batch.debtor.bic !== undefined) {
      lines.push(`          <BICFI>${xe(batch.debtor.bic)}</BICFI>`)
    }
    lines.push(`        </FinInstnId>`)
    lines.push(`      </DbtrAgt>`)
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
      lines.push(`        <Cdtr>`)
      lines.push(`          <Nm>${xe(tx.creditor.name)}</Nm>`)
      lines.push(`        </Cdtr>`)
      lines.push(`        <CdtrAcct>`)
      lines.push(`          <Id>`)
      lines.push(`            <IBAN>${xe(tx.creditor.iban)}</IBAN>`)
      lines.push(`          </Id>`)
      lines.push(`        </CdtrAcct>`)
      if (tx.remittanceInfo !== undefined) {
        lines.push(`        <RmtInf>`)
        lines.push(`          <Ustrd>${xe(tx.remittanceInfo)}</Ustrd>`)
        lines.push(`        </RmtInf>`)
      }
      lines.push(`      </CdtTrfTxInf>`)
    }

    lines.push(`    </PmtInf>`)
  }

  lines.push(`  </CstmrCdtTrfInitn>`)
  lines.push(`</Document>`)

  return lines.join('\n')
}
