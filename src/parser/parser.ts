/**
 * Parser for pain.001.001.09 XML documents.
 *
 * Reconstructs a CreditTransferDocument model from XML.
 * Uses fast-xml-parser for lightweight, correct XML parsing.
 *
 * Approach:
 * - Parse XML into a JS object tree
 * - Extract fields by XPath-like navigation
 * - Reconstruct Money from the formatted amount string (e.g. "123.45" -> minorUnits: 12345n)
 * - Validate the result through the Zod schema before returning
 *
 * ParseResult is a discriminated union: { ok: true; data } | { ok: false; error: string }
 */

import { XMLParser } from "fast-xml-parser";
import {
  CreditTransferDocumentSchema,
  type CreditTransferDocument,
  type AccountParty,
  type Transfer,
  type PaymentBatch,
  type Money,
} from "../model/schema.js";

// ---------------------------------------------------------------------------
// ParseResult type
// ---------------------------------------------------------------------------

export type ParseSuccess = { ok: true; data: CreditTransferDocument };
export type ParseFailure = { ok: false; error: string };
export type ParseResult = ParseSuccess | ParseFailure;

// ---------------------------------------------------------------------------
// XML parser configuration
// ---------------------------------------------------------------------------

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Always wrap repeated elements as arrays (PmtInf, CdtTrfTxInf)
  isArray: (tagName) =>
    tagName === "PmtInf" || tagName === "CdtTrfTxInf",
  // Preserve string values (don't auto-convert numbers/booleans)
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a decimal string from XML (e.g. "123.45") into a Money value.
 * The XML always has exactly 2 decimal places from our writer.
 * We also accept values with fewer decimals for robustness.
 */
function parseMoneyString(amountStr: string, ccy: string): Money | null {
  if (ccy !== "EUR") {
    return null;
  }
  const trimmed = amountStr.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const parts = trimmed.split(".");
  const wholePart = parts[0] ?? "0";
  const fracPart = (parts[1] ?? "0").padEnd(2, "0");
  const minorUnits = BigInt(wholePart) * 100n + BigInt(fracPart);
  return { currencyCode: "EUR", minorUnits };
}

/** Safely get a string value from a parsed object, or null. */
function str(val: unknown): string | null {
  if (typeof val === "string") return val;
  if (typeof val === "number") return String(val);
  return null;
}

/** Safely get a nested value by path, returning null if any step is missing. */
function nav(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const key of keys) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      return null;
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Extractor functions
// ---------------------------------------------------------------------------

function extractAccountParty(
  partyEl: unknown,
  acctEl: unknown,
  agtEl: unknown
): AccountParty | null {
  const name = str(nav(partyEl, "Nm"));
  if (!name) return null;

  const iban = str(nav(acctEl, "Id", "IBAN"));
  if (!iban) return null;

  const bic = str(nav(agtEl, "FinInstnId", "BICFI")) ?? undefined;

  return { name, iban, ...(bic !== undefined ? { bic } : {}) };
}

function extractTransfer(txEl: unknown): Transfer | null {
  if (!txEl || typeof txEl !== "object") return null;

  const endToEndId = str(nav(txEl, "PmtId", "EndToEndId"));
  if (!endToEndId) return null;

  // Amount: <Amt><InstdAmt Ccy="EUR">123.45</InstdAmt></Amt>
  const instdAmt = nav(txEl, "Amt", "InstdAmt");
  let amountStr: string | null = null;
  let ccy = "EUR";
  if (typeof instdAmt === "object" && instdAmt !== null) {
    const amtObj = instdAmt as Record<string, unknown>;
    amountStr = str(amtObj["#text"]);
    const rawCcy = amtObj["@_Ccy"];
    ccy = typeof rawCcy === "string" ? rawCcy : "EUR";
  } else {
    amountStr = str(instdAmt);
  }
  if (!amountStr) return null;

  const amount = parseMoneyString(amountStr, ccy);
  if (!amount) return null;

  // Creditor: Cdtr + CdtrAcct + CdtrAgt (optional)
  const cdtrEl = nav(txEl, "Cdtr");
  const cdtrAcctEl = nav(txEl, "CdtrAcct");
  const cdtrAgtEl = nav(txEl, "CdtrAgt");
  const creditor = extractAccountParty(cdtrEl, cdtrAcctEl, cdtrAgtEl);
  if (!creditor) return null;

  // Optional remittanceInfo
  const ustrd = str(nav(txEl, "RmtInf", "Ustrd"));
  const remittanceInfo = ustrd !== null ? ustrd : undefined;

  return {
    endToEndId,
    amount,
    creditor,
    ...(remittanceInfo !== undefined ? { remittanceInfo } : {}),
  };
}

function extractPaymentBatch(pmtInfEl: unknown): PaymentBatch | null {
  if (!pmtInfEl || typeof pmtInfEl !== "object") return null;

  const id = str(nav(pmtInfEl, "PmtInfId"));
  if (!id) return null;

  const executionDate = str(nav(pmtInfEl, "ReqdExctnDt", "Dt"));
  if (!executionDate) return null;

  // Debtor: Dbtr + DbtrAcct + DbtrAgt
  const dbtrEl = nav(pmtInfEl, "Dbtr");
  const dbtrAcctEl = nav(pmtInfEl, "DbtrAcct");
  const dbtrAgtEl = nav(pmtInfEl, "DbtrAgt");
  const debtor = extractAccountParty(dbtrEl, dbtrAcctEl, dbtrAgtEl);
  if (!debtor) return null;

  // Transactions (CdtTrfTxInf is always an array via isArray config)
  const txArray = nav(pmtInfEl, "CdtTrfTxInf");
  if (!Array.isArray(txArray) || txArray.length === 0) return null;

  const transfers: Transfer[] = [];
  for (const txEl of txArray) {
    const transfer = extractTransfer(txEl);
    if (!transfer) return null;
    transfers.push(transfer);
  }

  return { id, executionDate, debtor, transfers };
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

/**
 * Parse a pain.001.001.09 XML string into a CreditTransferDocument model.
 *
 * @param xml the XML string to parse
 * @returns ParseResult: { ok: true; data } or { ok: false; error: string }
 */
export function parse(xml: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = PARSER.parse(xml);
  } catch (e) {
    return {
      ok: false,
      error: `XML parse error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  try {
    // Navigate to the document root
    const root = nav(parsed, "Document", "CstmrCdtTrfInitn");
    if (!root) {
      return { ok: false, error: "Missing Document/CstmrCdtTrfInitn element" };
    }

    // Group Header
    const grpHdr = nav(root, "GrpHdr");
    if (!grpHdr) {
      return { ok: false, error: "Missing GrpHdr element" };
    }

    const messageId = str(nav(grpHdr, "MsgId"));
    if (!messageId) {
      return { ok: false, error: "Missing GrpHdr/MsgId" };
    }

    const createdAt = str(nav(grpHdr, "CreDtTm"));
    if (!createdAt) {
      return { ok: false, error: "Missing GrpHdr/CreDtTm" };
    }

    const initiatingParty = str(nav(grpHdr, "InitgPty", "Nm"));
    if (!initiatingParty) {
      return { ok: false, error: "Missing GrpHdr/InitgPty/Nm" };
    }

    // PmtInf (always an array via isArray config)
    const pmtInfArray = nav(root, "PmtInf");
    if (!Array.isArray(pmtInfArray) || pmtInfArray.length === 0) {
      return { ok: false, error: "Missing or empty PmtInf elements" };
    }

    const batches: PaymentBatch[] = [];
    for (const pmtInfEl of pmtInfArray) {
      const batch = extractPaymentBatch(pmtInfEl);
      if (!batch) {
        return { ok: false, error: "Failed to extract PaymentBatch from PmtInf" };
      }
      batches.push(batch);
    }

    const rawDoc: CreditTransferDocument = {
      messageId,
      createdAt,
      initiatingParty,
      batches,
    };

    // Final Zod validation to catch any remaining issues
    const validation = CreditTransferDocumentSchema.safeParse(rawDoc);
    if (!validation.success) {
      const messages = validation.error.issues
        .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
        .join("; ");
      return { ok: false, error: `Model validation failed after parse: ${messages}` };
    }

    return { ok: true, data: validation.data };
  } catch (e) {
    return {
      ok: false,
      error: `Parse error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
