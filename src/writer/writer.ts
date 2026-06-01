/**
 * XML writer for pain.001.001.09 (CustomerCreditTransferInitiation).
 *
 * Produces a UTF-8 XML string conforming to:
 * urn:iso:std:iso:20022:tech:xsd:pain.001.001.09
 *
 * Design invariants:
 * - Validates the model before writing (throws on invalid input)
 * - CtrlSum uses exact bigint arithmetic, never floating-point
 * - All string values are SEPA-charset sanitized and XML-escaped
 * - ReqdExctnDt is emitted as Dt (date only), never DtTm
 */

import { CreditTransferDocumentSchema, type CreditTransferDocument } from "../model/schema.js";
import { escapeXml } from "../model/charset.js";
import { formatAmount, sumAmounts } from "../model/amount.js";

const XMLNS = "urn:iso:std:iso:20022:tech:xsd:pain.001.001.09";

/** Escapes a value for use in XML text content. */
function xe(value: string): string {
  return escapeXml(value);
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
  const parseResult = CreditTransferDocumentSchema.safeParse(input);
  if (!parseResult.success) {
    const messages = parseResult.error.issues
      .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
      .join("; ");
    throw new Error(`Invalid CreditTransferDocument: ${messages}`);
  }
  const doc = parseResult.data;

  // Compute NbOfTxs and CtrlSum across all payment instructions
  const allTxAmounts = doc.paymentInstructions.flatMap((pmtInf) =>
    pmtInf.transactions.map((tx) => tx.amountMinorUnits)
  );
  const totalTxCount = allTxAmounts.length;
  const totalCtrlSum = sumAmounts(allTxAmounts);

  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<Document xmlns="${XMLNS}">`);
  lines.push(`  <CstmrCdtTrfInitn>`);

  // Group Header
  lines.push(`    <GrpHdr>`);
  lines.push(`      <MsgId>${xe(doc.groupHeader.messageId)}</MsgId>`);
  lines.push(`      <CreDtTm>${xe(doc.groupHeader.creationDateTime)}</CreDtTm>`);
  lines.push(`      <NbOfTxs>${totalTxCount}</NbOfTxs>`);
  lines.push(`      <CtrlSum>${formatAmount(totalCtrlSum)}</CtrlSum>`);
  lines.push(`      <InitgPty>`);
  lines.push(`        <Nm>${xe(doc.groupHeader.initiatingParty.name)}</Nm>`);
  lines.push(`      </InitgPty>`);
  lines.push(`    </GrpHdr>`);

  // Payment Instructions
  for (const pmtInf of doc.paymentInstructions) {
    const pmtTxAmounts = pmtInf.transactions.map((tx) => tx.amountMinorUnits);
    const pmtNbOfTxs = pmtTxAmounts.length;
    const pmtCtrlSum = sumAmounts(pmtTxAmounts);

    lines.push(`    <PmtInf>`);
    lines.push(`      <PmtInfId>${xe(pmtInf.paymentInfoId)}</PmtInfId>`);
    lines.push(`      <PmtMtd>TRF</PmtMtd>`);
    lines.push(`      <NbOfTxs>${pmtNbOfTxs}</NbOfTxs>`);
    lines.push(`      <CtrlSum>${formatAmount(pmtCtrlSum)}</CtrlSum>`);
    lines.push(`      <ReqdExctnDt>`);
    lines.push(`        <Dt>${xe(pmtInf.requestedExecutionDate)}</Dt>`);
    lines.push(`      </ReqdExctnDt>`);
    lines.push(`      <Dbtr>`);
    lines.push(`        <Nm>${xe(pmtInf.debtor.name)}</Nm>`);
    lines.push(`      </Dbtr>`);
    lines.push(`      <DbtrAcct>`);
    lines.push(`        <Id>`);
    lines.push(`          <IBAN>${xe(pmtInf.debtorIban)}</IBAN>`);
    lines.push(`        </Id>`);
    lines.push(`      </DbtrAcct>`);
    lines.push(`      <DbtrAgt>`);
    lines.push(`        <FinInstnId>`);
    if (pmtInf.debtorAgent.bic !== undefined) {
      lines.push(`          <BICFI>${xe(pmtInf.debtorAgent.bic)}</BICFI>`);
    }
    lines.push(`        </FinInstnId>`);
    lines.push(`      </DbtrAgt>`);

    // Credit Transfer Transactions
    for (const tx of pmtInf.transactions) {
      lines.push(`      <CdtTrfTxInf>`);
      lines.push(`        <PmtId>`);
      lines.push(`          <EndToEndId>${xe(tx.endToEndId)}</EndToEndId>`);
      lines.push(`        </PmtId>`);
      lines.push(`        <Amt>`);
      lines.push(
        `          <InstdAmt Ccy="EUR">${formatAmount(tx.amountMinorUnits)}</InstdAmt>`
      );
      lines.push(`        </Amt>`);
      lines.push(`        <Cdtr>`);
      lines.push(`          <Nm>${xe(tx.creditor.name)}</Nm>`);
      lines.push(`        </Cdtr>`);
      lines.push(`        <CdtrAcct>`);
      lines.push(`          <Id>`);
      lines.push(`            <IBAN>${xe(tx.creditorIban)}</IBAN>`);
      lines.push(`          </Id>`);
      lines.push(`        </CdtrAcct>`);
      lines.push(`      </CdtTrfTxInf>`);
    }

    lines.push(`    </PmtInf>`);
  }

  lines.push(`  </CstmrCdtTrfInitn>`);
  lines.push(`</Document>`);

  return lines.join("\n");
}
