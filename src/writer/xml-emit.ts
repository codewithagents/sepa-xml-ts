/**
 * Shared XML-emission helpers for the pain.001 and pain.008 writers.
 *
 * All helpers push to a caller-supplied string array. The array is later
 * joined with '\n' by the writer to form the final XML document.
 *
 * Indentation conventions used across both writers:
 *   2 spaces  - Document root element (CstmrCdtTrfInitn / CstmrDrctDbtInitn)
 *   4 spaces  - GrpHdr, PmtInf
 *   6 spaces  - PmtInf children, GrpHdr children
 *   8 spaces  - PmtTpInf children, transaction-level children (CdtTrfTxInf / DrctDbtTxInf)
 *  10 spaces  - nested inside 8-space elements
 *  12 spaces  - nested inside 10-space elements
 *
 * Internal module: not exported from index.ts.
 */

import { escapeXml } from '../model/charset.js'
import { formatAmountForXml, sumMoney } from '../model/amount.js'
import type { Money } from '../model/schema.js'

/**
 * Escape a value for use in XML text content.
 * Thin wrapper around escapeXml; kept here so writer files
 * import only from xml-emit.ts.
 */
export function xe(value: string): string {
  return escapeXml(value)
}

/** Compute total transaction count and control sum from an array of Money values. */
export function computeTotals(amounts: readonly Money[]): { txCount: number; ctrlSum: bigint } {
  return { txCount: amounts.length, ctrlSum: sumMoney(amounts) }
}

/**
 * Emit the GrpHdr block.
 * Produces 9 lines at fixed 4/6/8-space indentation (same in both writers).
 */
export function emitGrpHdr(
  lines: string[],
  messageId: string,
  createdAt: string,
  txCount: number,
  ctrlSum: bigint,
  initiatingParty: string
): void {
  lines.push(`    <GrpHdr>`)
  lines.push(`      <MsgId>${xe(messageId)}</MsgId>`)
  lines.push(`      <CreDtTm>${xe(createdAt)}</CreDtTm>`)
  lines.push(`      <NbOfTxs>${txCount}</NbOfTxs>`)
  lines.push(
    `      <CtrlSum>${formatAmountForXml({ currencyCode: 'EUR', minorUnits: ctrlSum })}</CtrlSum>`
  )
  lines.push(`      <InitgPty>`)
  lines.push(`        <Nm>${xe(initiatingParty)}</Nm>`)
  lines.push(`      </InitgPty>`)
  lines.push(`    </GrpHdr>`)
}

/**
 * Emit the SvcLvl/Cd=SEPA block inside a PmtTpInf element (8-space indent).
 * Both writers use this identically.
 */
export function emitSvcLvl(lines: string[]): void {
  lines.push(`        <SvcLvl>`)
  lines.push(`          <Cd>SEPA</Cd>`)
  lines.push(`        </SvcLvl>`)
}

/**
 * Emit a party element containing only a Nm child.
 * Used for Dbtr, Cdtr blocks that carry just the name.
 *
 * @param indent - leading spaces for the outer tag (e.g. "      " for 6 spaces)
 * @param tag    - element name, e.g. "Dbtr" or "Cdtr"
 * @param name   - party name (will be XML-escaped)
 */
export function emitNmElement(lines: string[], indent: string, tag: string, name: string): void {
  lines.push(`${indent}<${tag}>`)
  lines.push(`${indent}  <Nm>${xe(name)}</Nm>`)
  lines.push(`${indent}</${tag}>`)
}

/**
 * Emit an account element with an Id/IBAN child.
 * Used for DbtrAcct and CdtrAcct.
 *
 * @param indent - leading spaces for the outer tag
 * @param tag    - element name, e.g. "DbtrAcct" or "CdtrAcct"
 * @param iban   - IBAN string (will be XML-escaped)
 */
export function emitIbanAcct(lines: string[], indent: string, tag: string, iban: string): void {
  lines.push(`${indent}<${tag}>`)
  lines.push(`${indent}  <Id>`)
  lines.push(`${indent}    <IBAN>${xe(iban)}</IBAN>`)
  lines.push(`${indent}  </Id>`)
  lines.push(`${indent}</${tag}>`)
}

/**
 * Emit a FinInstnId wrapper element that is always present (required by XSD),
 * with an optional BICFI child.
 *
 * Used for DbtrAgt (pain.001 PmtInf level), CdtrAgt (pain.008 PmtInf level),
 * CdtrAgt (pain.001 transaction level), and DbtrAgt (pain.008 transaction level).
 *
 * @param indent - leading spaces for the outer agent tag (e.g. "      " for 6 spaces)
 * @param tag    - element name, e.g. "DbtrAgt" or "CdtrAgt"
 * @param bic    - optional BIC string (will be XML-escaped if present)
 */
export function emitAlwaysFinInstnId(
  lines: string[],
  indent: string,
  tag: string,
  bic?: string
): void {
  const inner = `${indent}  `
  const bicIndent = `${indent}    `
  lines.push(`${indent}<${tag}>`)
  lines.push(`${inner}<FinInstnId>`)
  if (bic !== undefined) {
    lines.push(`${bicIndent}<BICFI>${xe(bic)}</BICFI>`)
  }
  lines.push(`${inner}</FinInstnId>`)
  lines.push(`${indent}</${tag}>`)
}

/**
 * Emit the opening lines of a PmtInf element through CtrlSum.
 * Both writers share this block; the PmtMtd value ("TRF" or "DD") differs.
 *
 * XSD ordering for PmtInf children (pain.001.001.09 and pain.008.001.08):
 *   PmtInfId, PmtMtd, BtchBookg (optional), NbOfTxs, CtrlSum, PmtTpInf ...
 *
 * BtchBookg is inserted after PmtMtd and before NbOfTxs when batchBooking is
 * provided. When undefined, BtchBookg is not emitted (default behaviour).
 *
 * Callers emit PmtTpInf (and its contents) immediately after.
 */
export function emitPmtInfHeader(
  lines: string[],
  id: string,
  pmtMtd: string,
  nbOfTxs: number,
  ctrlSum: bigint,
  batchBooking?: boolean
): void {
  lines.push(`    <PmtInf>`)
  lines.push(`      <PmtInfId>${xe(id)}</PmtInfId>`)
  lines.push(`      <PmtMtd>${pmtMtd}</PmtMtd>`)
  if (batchBooking !== undefined) {
    lines.push(`      <BtchBookg>${batchBooking ? 'true' : 'false'}</BtchBookg>`)
  }
  lines.push(`      <NbOfTxs>${nbOfTxs}</NbOfTxs>`)
  lines.push(
    `      <CtrlSum>${formatAmountForXml({ currencyCode: 'EUR', minorUnits: ctrlSum })}</CtrlSum>`
  )
}

/**
 * Emit a conditional RmtInf/Ustrd element at 8-space indent.
 * Used in both CdtTrfTxInf (pain.001) and DrctDbtTxInf (pain.008).
 *
 * @param remittanceInfo - optional remittance text; nothing is emitted if undefined
 */
export function emitRmtInf(lines: string[], remittanceInfo: string | undefined): void {
  if (remittanceInfo !== undefined) {
    lines.push(`        <RmtInf>`)
    lines.push(`          <Ustrd>${xe(remittanceInfo)}</Ustrd>`)
    lines.push(`        </RmtInf>`)
  }
}
