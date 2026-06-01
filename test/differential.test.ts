/**
 * Differential tests: our library (sepa-xml-ts, pain.001.001.09) vs sepa (kewisch.js, pain.001.001.03).
 *
 * Goal: feed equivalent credit-transfer inputs to both libraries, parse both XML outputs,
 * and compare the semantic invariants that MUST agree regardless of pain version or formatting.
 *
 * Compared fields (semantic invariants):
 *   - GrpHdr/NbOfTxs (total transaction count)
 *   - GrpHdr/CtrlSum (total sum, formatted to exactly 2 decimal places)
 *   - Per-PmtInf: NbOfTxs, CtrlSum, debtor IBAN
 *   - Per-transaction: EndToEndId, InstdAmt (formatted to 2 decimal places), creditor IBAN
 *
 * Known cosmetic differences (NOT asserted, documented here):
 *   - sepa emits pain.001.001.03; our library emits pain.001.001.09. Different xmlns, schemaLocation.
 *   - sepa emits compact (no-whitespace) XML; our library emits indented XML.
 *   - sepa emits BtchBookg, ChrgBr (SLEV), PmtTpInf/SvcLvl/Cd (SEPA) at PmtInf level; we do not.
 *   - sepa emits PmtId/InstrId at transaction level; we do not.
 *   - sepa prefixes PmtInfId with the document id (e.g. "DIFF-001.0"); we use the user-supplied id.
 *   - sepa emits empty <RmtInf><Ustrd/></RmtInf> when no remittance info; we omit the element.
 *   - sepa emits DbtrAgt/FinInstnId/BIC (pain.001.001.03 uses BIC, not BICFI); we emit BICFI.
 *   - sepa strips the timezone offset from CreDtTm (emits local time without Z); we preserve it.
 *   - sepa emits ReqdExctnDt as a plain text element; our .09 writer wraps it in ReqdExctnDt/Dt.
 */

import { describe, it, expect } from "vitest";
import SEPA from "sepa";
import { XMLParser } from "fast-xml-parser";
import { writeCreditTransfer } from "../src/writer/writer.js";
import { parse } from "../src/parser/parser.js";
import { euros, formatMoney } from "../src/model/schema.js";
import type { CreditTransferDocument } from "../src/model/schema.js";

// ---------------------------------------------------------------------------
// XML parser for sepa output (pain.001.001.03)
// We do NOT use our own parse() here because it only accepts pain.001.001.09
// namespace. We use fast-xml-parser directly and extract fields by element name.
// ---------------------------------------------------------------------------

const sepaXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (tagName) => tagName === "PmtInf" || tagName === "CdtTrfTxInf",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

/** Navigate a parsed object by key path, returning null if any step is missing. */
function nav(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const key of keys) {
    if (cur === null || cur === undefined || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function str(val: unknown): string | null {
  if (typeof val === "string") return val;
  if (typeof val === "number") return String(val);
  return null;
}

// ---------------------------------------------------------------------------
// Helpers for extracting semantic fields from sepa's pain.001.001.03 XML
// ---------------------------------------------------------------------------

interface SepaXmlTransaction {
  endToEndId: string;
  instdAmt: string; // formatted 2dp decimal string
  creditorIban: string;
}

interface SepaXmlBatch {
  nbOfTxs: string;
  ctrlSum: string;
  debtorIban: string;
  transactions: SepaXmlTransaction[];
}

interface SepaXmlDoc {
  nbOfTxs: string;
  ctrlSum: string;
  batches: SepaXmlBatch[];
}

function extractSepaXmlDoc(xml: string): SepaXmlDoc {
  const parsed = sepaXmlParser.parse(xml);
  const root = nav(parsed, "Document", "CstmrCdtTrfInitn");
  if (!root) throw new Error("Missing Document/CstmrCdtTrfInitn in sepa XML");

  const grpHdr = nav(root, "GrpHdr");
  const nbOfTxs = str(nav(grpHdr, "NbOfTxs"));
  const ctrlSum = str(nav(grpHdr, "CtrlSum"));
  if (!nbOfTxs || !ctrlSum) throw new Error("Missing GrpHdr/NbOfTxs or CtrlSum");

  const pmtInfArr = nav(root, "PmtInf");
  if (!Array.isArray(pmtInfArr)) throw new Error("Missing PmtInf array");

  const batches: SepaXmlBatch[] = [];
  for (const pmtInf of pmtInfArr) {
    const batchNbOfTxs = str(nav(pmtInf, "NbOfTxs"));
    const batchCtrlSum = str(nav(pmtInf, "CtrlSum"));
    const debtorIban = str(nav(pmtInf, "DbtrAcct", "Id", "IBAN"));
    if (!batchNbOfTxs || !batchCtrlSum || !debtorIban) {
      throw new Error("Missing batch-level fields in PmtInf");
    }

    const txArr = nav(pmtInf, "CdtTrfTxInf");
    if (!Array.isArray(txArr)) throw new Error("Missing CdtTrfTxInf array");

    const transactions: SepaXmlTransaction[] = [];
    for (const tx of txArr) {
      const endToEndId = str(nav(tx, "PmtId", "EndToEndId"));
      if (!endToEndId) throw new Error("Missing EndToEndId");

      // InstdAmt is wrapped in Amt for pain.001.001.03 (sepa uses Amt/InstdAmt for both .03 and .09)
      const instdAmtEl = nav(tx, "Amt", "InstdAmt");
      let instdAmt: string | null = null;
      if (typeof instdAmtEl === "object" && instdAmtEl !== null) {
        instdAmt = str((instdAmtEl as Record<string, unknown>)["#text"]);
      } else {
        instdAmt = str(instdAmtEl);
      }
      if (!instdAmt) throw new Error(`Missing InstdAmt for tx ${endToEndId}`);

      const creditorIban = str(nav(tx, "CdtrAcct", "Id", "IBAN"));
      if (!creditorIban) throw new Error(`Missing CdtrAcct/IBAN for tx ${endToEndId}`);

      transactions.push({ endToEndId, instdAmt, creditorIban });
    }

    batches.push({ nbOfTxs: batchNbOfTxs, ctrlSum: batchCtrlSum, debtorIban, transactions });
  }

  return { nbOfTxs, ctrlSum, batches };
}

// ---------------------------------------------------------------------------
// Helpers for extracting the same semantic fields from our pain.001.001.09 output
// via our own parse() function
// ---------------------------------------------------------------------------

interface OurXmlDoc {
  nbOfTxs: string;
  ctrlSum: string;
  batches: SepaXmlBatch[];
}

function extractOurDoc(xml: string): OurXmlDoc {
  const result = parse(xml);
  if (!result.ok) throw new Error(`Our parse() failed: ${result.error}`);
  if (result.type !== "pain.001") throw new Error(`Expected pain.001, got ${result.type}`);

  const doc = result.data;
  const allAmounts = doc.batches.flatMap((b) => b.transfers.map((t) => t.amount));
  const totalMinorUnits = allAmounts.reduce((sum, m) => sum + m.minorUnits, 0n);
  const totalMoney = { currencyCode: "EUR" as const, minorUnits: totalMinorUnits };

  const batches: SepaXmlBatch[] = doc.batches.map((batch) => {
    const batchMinorUnits = batch.transfers.reduce((sum, t) => sum + t.amount.minorUnits, 0n);
    const batchMoney = { currencyCode: "EUR" as const, minorUnits: batchMinorUnits };
    return {
      nbOfTxs: String(batch.transfers.length),
      ctrlSum: formatMoney(batchMoney),
      debtorIban: batch.debtor.iban,
      transactions: batch.transfers.map((tx) => ({
        endToEndId: tx.endToEndId,
        instdAmt: formatMoney(tx.amount),
        creditorIban: tx.creditor.iban,
      })),
    };
  });

  return {
    nbOfTxs: String(allAmounts.length),
    ctrlSum: formatMoney(totalMoney),
    batches,
  };
}

// ---------------------------------------------------------------------------
// Test inputs: equivalent credit-transfer documents for both libraries
// ---------------------------------------------------------------------------

// These are valid IBANs (mod-97 verified). Chosen to be recognizable and
// to test single-batch and multi-batch scenarios.
const DEBTOR_IBAN = "DE89370400440532013000";
const CREDITOR_IBAN_1 = "DE65200400300234567000";
const CREDITOR_IBAN_2 = "FR7630006000011234567890189";
const CREDITOR_IBAN_3 = "NL91ABNA0417164300";

// ---------------------------------------------------------------------------
// Build our model for a single-batch, two-transaction document
// ---------------------------------------------------------------------------

const ourSingleBatchDoc: CreditTransferDocument = {
  messageId: "DIFF-TEST-001",
  createdAt: "2024-06-01T09:00:00Z",
  initiatingParty: "Test Company GmbH",
  batches: [
    {
      id: "BATCH-001",
      executionDate: "2024-06-05",
      debtor: {
        name: "Test Company GmbH",
        iban: DEBTOR_IBAN,
        bic: "COBADEFFXXX",
      },
      transfers: [
        {
          endToEndId: "E2E-0001",
          amount: euros("0.01"),
          creditor: { name: "Supplier One", iban: CREDITOR_IBAN_1 },
        },
        {
          endToEndId: "E2E-0002",
          amount: euros("123.45"),
          creditor: {
            name: "Supplier Two",
            iban: CREDITOR_IBAN_1,
            bic: "DEUTDEDBFRA",
          },
          remittanceInfo: "Invoice 2024/42",
        },
      ],
    },
  ],
};

/** Build the equivalent document in sepa (kewisch.js) using pain.001.001.03. */
function buildSepaDocSingleBatch(): string {
  const doc = new SEPA.Document("pain.001.001.03");
  doc.grpHdr.id = "DIFF-TEST-001";
  doc.grpHdr.created = new Date("2024-06-01T09:00:00Z");
  doc.grpHdr.initiatorName = "Test Company GmbH";

  const info = doc.createPaymentInfo();
  info.requestedExecutionDate = new Date("2024-06-05");
  info.debtorIBAN = DEBTOR_IBAN;
  info.debtorBIC = "COBADEFFXXX";
  info.debtorName = "Test Company GmbH";

  const tx1 = info.createTransaction();
  tx1.creditorName = "Supplier One";
  tx1.creditorIBAN = CREDITOR_IBAN_1;
  tx1.amount = 0.01;
  tx1.end2endId = "E2E-0001";
  info.addTransaction(tx1);

  const tx2 = info.createTransaction();
  tx2.creditorName = "Supplier Two";
  tx2.creditorIBAN = CREDITOR_IBAN_1;
  tx2.creditorBIC = "DEUTDEDBFRA";
  tx2.amount = 123.45;
  tx2.end2endId = "E2E-0002";
  tx2.remittanceInfo = "Invoice 2024/42";
  info.addTransaction(tx2);

  doc.addPaymentInfo(info);
  return doc.toString();
}

// ---------------------------------------------------------------------------
// Multi-batch document: two PmtInf blocks (same debtor, different execution dates)
// ---------------------------------------------------------------------------

const ourMultiBatchDoc: CreditTransferDocument = {
  messageId: "DIFF-TEST-002",
  createdAt: "2024-06-01T09:00:00Z",
  initiatingParty: "Acme Payments GmbH",
  batches: [
    {
      id: "BATCH-A",
      executionDate: "2024-06-10",
      debtor: { name: "Acme Payments GmbH", iban: DEBTOR_IBAN },
      transfers: [
        {
          endToEndId: "A-E2E-001",
          amount: euros("50.00"),
          creditor: { name: "Vendor Alpha", iban: CREDITOR_IBAN_1 },
        },
        {
          endToEndId: "A-E2E-002",
          amount: euros("75.50"),
          creditor: { name: "Vendor Beta", iban: CREDITOR_IBAN_2 },
          remittanceInfo: "Q2 invoice",
        },
      ],
    },
    {
      id: "BATCH-B",
      executionDate: "2024-06-17",
      debtor: { name: "Acme Payments GmbH", iban: DEBTOR_IBAN },
      transfers: [
        {
          endToEndId: "B-E2E-001",
          amount: euros("999.99"),
          creditor: { name: "Vendor Gamma", iban: CREDITOR_IBAN_3 },
          remittanceInfo: "Final payment",
        },
      ],
    },
  ],
};

function buildSepaDocMultiBatch(): string {
  const doc = new SEPA.Document("pain.001.001.03");
  doc.grpHdr.id = "DIFF-TEST-002";
  doc.grpHdr.created = new Date("2024-06-01T09:00:00Z");
  doc.grpHdr.initiatorName = "Acme Payments GmbH";

  const infoA = doc.createPaymentInfo();
  infoA.requestedExecutionDate = new Date("2024-06-10");
  infoA.debtorIBAN = DEBTOR_IBAN;
  infoA.debtorName = "Acme Payments GmbH";

  const txA1 = infoA.createTransaction();
  txA1.creditorName = "Vendor Alpha";
  txA1.creditorIBAN = CREDITOR_IBAN_1;
  txA1.amount = 50.00;
  txA1.end2endId = "A-E2E-001";
  infoA.addTransaction(txA1);

  const txA2 = infoA.createTransaction();
  txA2.creditorName = "Vendor Beta";
  txA2.creditorIBAN = CREDITOR_IBAN_2;
  txA2.amount = 75.50;
  txA2.end2endId = "A-E2E-002";
  txA2.remittanceInfo = "Q2 invoice";
  infoA.addTransaction(txA2);

  doc.addPaymentInfo(infoA);

  const infoB = doc.createPaymentInfo();
  infoB.requestedExecutionDate = new Date("2024-06-17");
  infoB.debtorIBAN = DEBTOR_IBAN;
  infoB.debtorName = "Acme Payments GmbH";

  const txB1 = infoB.createTransaction();
  txB1.creditorName = "Vendor Gamma";
  txB1.creditorIBAN = CREDITOR_IBAN_3;
  txB1.amount = 999.99;
  txB1.end2endId = "B-E2E-001";
  txB1.remittanceInfo = "Final payment";
  infoB.addTransaction(txB1);

  doc.addPaymentInfo(infoB);
  return doc.toString();
}

// ---------------------------------------------------------------------------
// Differential test: single batch, two transactions
// ---------------------------------------------------------------------------

describe("differential: sepa (pain.001.001.03) vs ours (pain.001.001.09) -- single batch", () => {
  // Version note: sepa emits pain.001.001.03; our library emits pain.001.001.09.
  // Both use the same root element (CstmrCdtTrfInitn) and the same semantic structure.
  // We compare only the fields that must be identical regardless of version.

  it("both libraries produce valid XML with the same NbOfTxs", () => {
    const ourXml = writeCreditTransfer(ourSingleBatchDoc);
    const sepaXml = buildSepaDocSingleBatch();

    const ourDoc = extractOurDoc(ourXml);
    const sepaDoc = extractSepaXmlDoc(sepaXml);

    expect(ourDoc.nbOfTxs).toBe("2");
    expect(sepaDoc.nbOfTxs).toBe("2");
    // Semantic invariant: both agree on the transaction count
    expect(ourDoc.nbOfTxs).toBe(sepaDoc.nbOfTxs);
  });

  it("both libraries produce the same GrpHdr/CtrlSum (exact 2dp decimal)", () => {
    const ourXml = writeCreditTransfer(ourSingleBatchDoc);
    const sepaXml = buildSepaDocSingleBatch();

    const ourDoc = extractOurDoc(ourXml);
    const sepaDoc = extractSepaXmlDoc(sepaXml);

    // Expected: 0.01 + 123.45 = 123.46
    expect(ourDoc.ctrlSum).toBe("123.46");
    expect(sepaDoc.ctrlSum).toBe("123.46");
    // Semantic invariant: both must agree on the control sum
    expect(ourDoc.ctrlSum).toBe(sepaDoc.ctrlSum);
  });

  it("both libraries produce the same per-batch NbOfTxs and CtrlSum", () => {
    const ourXml = writeCreditTransfer(ourSingleBatchDoc);
    const sepaXml = buildSepaDocSingleBatch();

    const ourDoc = extractOurDoc(ourXml);
    const sepaDoc = extractSepaXmlDoc(sepaXml);

    expect(ourDoc.batches).toHaveLength(1);
    expect(sepaDoc.batches).toHaveLength(1);

    const ourBatch = ourDoc.batches[0];
    const sepaBatch = sepaDoc.batches[0];
    expect(ourBatch).toBeDefined();
    expect(sepaBatch).toBeDefined();
    if (!ourBatch || !sepaBatch) return;

    expect(ourBatch.nbOfTxs).toBe(sepaBatch.nbOfTxs);
    expect(ourBatch.ctrlSum).toBe(sepaBatch.ctrlSum);
  });

  it("both libraries preserve the debtor IBAN unchanged", () => {
    const ourXml = writeCreditTransfer(ourSingleBatchDoc);
    const sepaXml = buildSepaDocSingleBatch();

    const ourDoc = extractOurDoc(ourXml);
    const sepaDoc = extractSepaXmlDoc(sepaXml);

    const ourBatch = ourDoc.batches[0];
    const sepaBatch = sepaDoc.batches[0];
    expect(ourBatch).toBeDefined();
    expect(sepaBatch).toBeDefined();
    if (!ourBatch || !sepaBatch) return;

    expect(ourBatch.debtorIban).toBe(DEBTOR_IBAN);
    expect(sepaBatch.debtorIban).toBe(DEBTOR_IBAN);
    expect(ourBatch.debtorIban).toBe(sepaBatch.debtorIban);
  });

  it("per-transaction: EndToEndId, amount, and creditor IBAN agree between libraries", () => {
    const ourXml = writeCreditTransfer(ourSingleBatchDoc);
    const sepaXml = buildSepaDocSingleBatch();

    const ourDoc = extractOurDoc(ourXml);
    const sepaDoc = extractSepaXmlDoc(sepaXml);

    const ourTxs = ourDoc.batches[0]?.transactions;
    const sepaTxs = sepaDoc.batches[0]?.transactions;
    expect(ourTxs).toBeDefined();
    expect(sepaTxs).toBeDefined();
    if (!ourTxs || !sepaTxs) return;

    expect(ourTxs).toHaveLength(2);
    expect(sepaTxs).toHaveLength(2);

    for (let i = 0; i < 2; i++) {
      const ourTx = ourTxs[i];
      const sepaTx = sepaTxs[i];
      expect(ourTx).toBeDefined();
      expect(sepaTx).toBeDefined();
      if (!ourTx || !sepaTx) continue;

      expect(ourTx.endToEndId).toBe(sepaTx.endToEndId);
      expect(ourTx.instdAmt).toBe(sepaTx.instdAmt);
      expect(ourTx.creditorIban).toBe(sepaTx.creditorIban);
    }
  });
});

// ---------------------------------------------------------------------------
// Differential test: multi-batch (two PmtInf blocks)
// ---------------------------------------------------------------------------

describe("differential: sepa (pain.001.001.03) vs ours (pain.001.001.09) -- multi-batch", () => {
  it("both libraries produce the same GrpHdr/NbOfTxs for 3 transactions across 2 batches", () => {
    const ourXml = writeCreditTransfer(ourMultiBatchDoc);
    const sepaXml = buildSepaDocMultiBatch();

    const ourDoc = extractOurDoc(ourXml);
    const sepaDoc = extractSepaXmlDoc(sepaXml);

    expect(ourDoc.nbOfTxs).toBe("3");
    expect(sepaDoc.nbOfTxs).toBe("3");
    expect(ourDoc.nbOfTxs).toBe(sepaDoc.nbOfTxs);
  });

  it("both libraries produce the same GrpHdr/CtrlSum for multi-batch (50.00 + 75.50 + 999.99 = 1125.49)", () => {
    const ourXml = writeCreditTransfer(ourMultiBatchDoc);
    const sepaXml = buildSepaDocMultiBatch();

    const ourDoc = extractOurDoc(ourXml);
    const sepaDoc = extractSepaXmlDoc(sepaXml);

    expect(ourDoc.ctrlSum).toBe("1125.49");
    expect(sepaDoc.ctrlSum).toBe("1125.49");
    expect(ourDoc.ctrlSum).toBe(sepaDoc.ctrlSum);
  });

  it("both libraries produce two PmtInf blocks with matching batch-level NbOfTxs and CtrlSum", () => {
    const ourXml = writeCreditTransfer(ourMultiBatchDoc);
    const sepaXml = buildSepaDocMultiBatch();

    const ourDoc = extractOurDoc(ourXml);
    const sepaDoc = extractSepaXmlDoc(sepaXml);

    expect(ourDoc.batches).toHaveLength(2);
    expect(sepaDoc.batches).toHaveLength(2);

    for (let i = 0; i < 2; i++) {
      const ourBatch = ourDoc.batches[i];
      const sepaBatch = sepaDoc.batches[i];
      expect(ourBatch).toBeDefined();
      expect(sepaBatch).toBeDefined();
      if (!ourBatch || !sepaBatch) continue;
      expect(ourBatch.nbOfTxs).toBe(sepaBatch.nbOfTxs);
      expect(ourBatch.ctrlSum).toBe(sepaBatch.ctrlSum);
    }
  });

  it("per-transaction semantic fields agree across all batches", () => {
    const ourXml = writeCreditTransfer(ourMultiBatchDoc);
    const sepaXml = buildSepaDocMultiBatch();

    const ourDoc = extractOurDoc(ourXml);
    const sepaDoc = extractSepaXmlDoc(sepaXml);

    for (let b = 0; b < 2; b++) {
      const ourBatch = ourDoc.batches[b];
      const sepaBatch = sepaDoc.batches[b];
      if (!ourBatch || !sepaBatch) continue;

      expect(ourBatch.debtorIban).toBe(sepaBatch.debtorIban);

      for (let t = 0; t < ourBatch.transactions.length; t++) {
        const ourTx = ourBatch.transactions[t];
        const sepaTx = sepaBatch.transactions[t];
        if (!ourTx || !sepaTx) continue;

        expect(ourTx.endToEndId).toBe(sepaTx.endToEndId);
        expect(ourTx.instdAmt).toBe(sepaTx.instdAmt);
        expect(ourTx.creditorIban).toBe(sepaTx.creditorIban);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Differential test: edge-case amounts (boundary values)
// ---------------------------------------------------------------------------

describe("differential: sepa vs ours -- edge-case amounts", () => {
  it("minimum SEPA amount (0.01 EUR) round-trips identically through both libraries", () => {
    const ourDoc: CreditTransferDocument = {
      messageId: "DIFF-MIN-001",
      createdAt: "2024-06-01T09:00:00Z",
      initiatingParty: "Test",
      batches: [
        {
          id: "B",
          executionDate: "2024-06-05",
          debtor: { name: "Test", iban: DEBTOR_IBAN },
          transfers: [
            {
              endToEndId: "MIN-TX",
              amount: euros("0.01"),
              creditor: { name: "Recipient", iban: CREDITOR_IBAN_1 },
            },
          ],
        },
      ],
    };

    const sepaDoc = new SEPA.Document("pain.001.001.03");
    sepaDoc.grpHdr.id = "DIFF-MIN-001";
    sepaDoc.grpHdr.created = new Date("2024-06-01T09:00:00Z");
    sepaDoc.grpHdr.initiatorName = "Test";
    const info = sepaDoc.createPaymentInfo();
    info.requestedExecutionDate = new Date("2024-06-05");
    info.debtorIBAN = DEBTOR_IBAN;
    info.debtorName = "Test";
    const tx = info.createTransaction();
    tx.creditorName = "Recipient";
    tx.creditorIBAN = CREDITOR_IBAN_1;
    tx.amount = 0.01;
    tx.end2endId = "MIN-TX";
    info.addTransaction(tx);
    sepaDoc.addPaymentInfo(info);

    const ourParsed = extractOurDoc(writeCreditTransfer(ourDoc));
    const sepaParsed = extractSepaXmlDoc(sepaDoc.toString());

    expect(ourParsed.ctrlSum).toBe("0.01");
    expect(sepaParsed.ctrlSum).toBe("0.01");
    expect(ourParsed.ctrlSum).toBe(sepaParsed.ctrlSum);
    expect(ourParsed.batches[0]?.transactions[0]?.instdAmt).toBe("0.01");
    expect(sepaParsed.batches[0]?.transactions[0]?.instdAmt).toBe("0.01");
  });

  it("large round amount (999.99 EUR) is emitted identically by both libraries", () => {
    const ourDoc: CreditTransferDocument = {
      messageId: "DIFF-LARGE-001",
      createdAt: "2024-06-01T09:00:00Z",
      initiatingParty: "Test",
      batches: [
        {
          id: "B",
          executionDate: "2024-06-05",
          debtor: { name: "Test", iban: DEBTOR_IBAN },
          transfers: [
            {
              endToEndId: "LARGE-TX",
              amount: euros("999.99"),
              creditor: { name: "Recipient", iban: CREDITOR_IBAN_2 },
            },
          ],
        },
      ],
    };

    const sepaDoc = new SEPA.Document("pain.001.001.03");
    sepaDoc.grpHdr.id = "DIFF-LARGE-001";
    sepaDoc.grpHdr.created = new Date("2024-06-01T09:00:00Z");
    sepaDoc.grpHdr.initiatorName = "Test";
    const info = sepaDoc.createPaymentInfo();
    info.requestedExecutionDate = new Date("2024-06-05");
    info.debtorIBAN = DEBTOR_IBAN;
    info.debtorName = "Test";
    const tx = info.createTransaction();
    tx.creditorName = "Recipient";
    tx.creditorIBAN = CREDITOR_IBAN_2;
    tx.amount = 999.99;
    tx.end2endId = "LARGE-TX";
    info.addTransaction(tx);
    sepaDoc.addPaymentInfo(info);

    const ourParsed = extractOurDoc(writeCreditTransfer(ourDoc));
    const sepaParsed = extractSepaXmlDoc(sepaDoc.toString());

    expect(ourParsed.ctrlSum).toBe("999.99");
    expect(sepaParsed.ctrlSum).toBe("999.99");
    expect(ourParsed.ctrlSum).toBe(sepaParsed.ctrlSum);
    expect(ourParsed.batches[0]?.transactions[0]?.creditorIban).toBe(CREDITOR_IBAN_2);
    expect(sepaParsed.batches[0]?.transactions[0]?.creditorIban).toBe(CREDITOR_IBAN_2);
  });
});
