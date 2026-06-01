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
import { escapeXml } from '../model/charset.js'
import { formatAmountForXml, sumMoney } from '../model/amount.js'

const XMLNS = 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.08'

/** Escapes a value for use in XML text content. */
function xe(value: string): string {
  return escapeXml(value)
}

/**
 * Write a pain.008.001.08 direct debit document to an XML string.
 *
 * The model is validated before writing. If validation fails, an error is thrown
 * with a human-readable description of the issue.
 *
 * @param input the direct debit document model
 * @returns UTF-8 XML string
 * @throws Error if the model fails validation
 */
export function writeDirectDebit(input: DirectDebitDocument): string {
  // Self-check: validate the model before writing
  const parseResult = DirectDebitDocumentSchema.safeParse(input)
  if (!parseResult.success) {
    const messages = parseResult.error.issues
      .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
      .join('; ')
    throw new Error(`Invalid DirectDebitDocument: ${messages}`)
  }
  const doc = parseResult.data

  // Compute NbOfTxs and CtrlSum across all batches
  const allAmounts = doc.batches.flatMap((batch) => batch.collections.map((col) => col.amount))
  const totalTxCount = allAmounts.length
  const totalCtrlSum = sumMoney(allAmounts)

  const lines: string[] = []

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`)
  lines.push(`<Document xmlns="${XMLNS}">`)
  lines.push(`  <CstmrDrctDbtInitn>`)

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
    const batchAmounts = batch.collections.map((col) => col.amount)
    const batchNbOfTxs = batchAmounts.length
    const batchCtrlSum = sumMoney(batchAmounts)
    const localInstrument = batch.localInstrument ?? 'CORE'

    lines.push(`    <PmtInf>`)
    lines.push(`      <PmtInfId>${xe(batch.id)}</PmtInfId>`)
    lines.push(`      <PmtMtd>DD</PmtMtd>`)
    lines.push(`      <NbOfTxs>${batchNbOfTxs}</NbOfTxs>`)
    lines.push(
      `      <CtrlSum>${formatAmountForXml({ currencyCode: 'EUR', minorUnits: batchCtrlSum })}</CtrlSum>`
    )
    lines.push(`      <PmtTpInf>`)
    lines.push(`        <SvcLvl>`)
    lines.push(`          <Cd>SEPA</Cd>`)
    lines.push(`        </SvcLvl>`)
    lines.push(`        <LclInstrm>`)
    lines.push(`          <Cd>${localInstrument}</Cd>`)
    lines.push(`        </LclInstrm>`)
    lines.push(`        <SeqTp>${batch.sequenceType}</SeqTp>`)
    lines.push(`      </PmtTpInf>`)
    lines.push(`      <ReqdColltnDt>${xe(batch.collectionDate)}</ReqdColltnDt>`)

    // Creditor (fans out doc-level creditor into each PmtInf)
    lines.push(`      <Cdtr>`)
    lines.push(`        <Nm>${xe(doc.creditor.name)}</Nm>`)
    lines.push(`      </Cdtr>`)
    lines.push(`      <CdtrAcct>`)
    lines.push(`        <Id>`)
    lines.push(`          <IBAN>${xe(doc.creditor.iban)}</IBAN>`)
    lines.push(`        </Id>`)
    lines.push(`      </CdtrAcct>`)
    // CdtrAgt is required in XSD (PaymentInstruction29); emit empty FinInstnId when no BIC
    lines.push(`      <CdtrAgt>`)
    lines.push(`        <FinInstnId>`)
    if (doc.creditor.bic !== undefined) {
      lines.push(`          <BICFI>${xe(doc.creditor.bic)}</BICFI>`)
    }
    lines.push(`        </FinInstnId>`)
    lines.push(`      </CdtrAgt>`)
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
      lines.push(`        <DbtrAgt>`)
      lines.push(`          <FinInstnId>`)
      if (col.debtor.bic !== undefined) {
        lines.push(`            <BICFI>${xe(col.debtor.bic)}</BICFI>`)
      }
      lines.push(`          </FinInstnId>`)
      lines.push(`        </DbtrAgt>`)
      lines.push(`        <Dbtr>`)
      lines.push(`          <Nm>${xe(col.debtor.name)}</Nm>`)
      lines.push(`        </Dbtr>`)
      lines.push(`        <DbtrAcct>`)
      lines.push(`          <Id>`)
      lines.push(`            <IBAN>${xe(col.debtor.iban)}</IBAN>`)
      lines.push(`          </Id>`)
      lines.push(`        </DbtrAcct>`)
      if (col.remittanceInfo !== undefined) {
        lines.push(`        <RmtInf>`)
        lines.push(`          <Ustrd>${xe(col.remittanceInfo)}</Ustrd>`)
        lines.push(`        </RmtInf>`)
      }
      lines.push(`      </DrctDbtTxInf>`)
    }

    lines.push(`    </PmtInf>`)
  }

  lines.push(`  </CstmrDrctDbtInitn>`)
  lines.push(`</Document>`)

  return lines.join('\n')
}
