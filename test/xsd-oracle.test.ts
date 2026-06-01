/**
 * XSD-oracle property test for pain.001.001.09.
 *
 * Core guarantee: for any valid model, writeCreditTransfer(model) produces XML
 * that passes XSD validation against the official EPC/ISO 20022 schema.
 *
 * numRuns >= 200
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fc from "fast-check";
import { writeCreditTransfer } from "../src/writer/writer.js";
import { validateXsd } from "../src/xsd.js";
import { buildIban } from "../src/model/iban.js";
import { sanitizeSepa } from "../src/model/charset.js";
import type { CreditTransferDocument } from "../src/model/schema.js";

// ---------------------------------------------------------------------------
// Helpers: deterministic IBAN generation via mod-97 builder
// ---------------------------------------------------------------------------

/**
 * Countries with BBAN structures that fit [a-zA-Z0-9]{1,30}.
 * Each entry: [countryCode, bbanLength] where all digits are used (simple).
 */
const IBAN_COUNTRIES: Array<[string, number]> = [
  ["DE", 18], // Germany: 8-digit BLZ + 10-digit account
  ["FR", 23], // France: 10-digit bank/branch + 11-digit account + 2-digit key
  ["NL", 14], // Netherlands: 4-letter bank code + 10-digit account
  ["ES", 20], // Spain
  ["IT", 23], // Italy
  ["AT", 16], // Austria
  ["BE", 12], // Belgium
  ["PT", 21], // Portugal
  ["FI", 14], // Finland
  ["LU", 16], // Luxembourg
];

/**
 * Arbitrary that produces a valid IBAN (passes mod-97 checksum).
 * The BBAN is all-digits for simplicity; this satisfies the XSD pattern.
 */
function arbIban(): fc.Arbitrary<string> {
  return fc.integer({ min: 0, max: IBAN_COUNTRIES.length - 1 }).chain((idx) => {
    const entry = IBAN_COUNTRIES[idx];
    if (entry === undefined) {
      throw new Error(`IBAN_COUNTRIES index out of range: ${idx}`);
    }
    const [country, bbanLen] = entry;
    // Generate a random all-digit BBAN of the correct length
    return fc
      .array(fc.integer({ min: 0, max: 9 }), { minLength: bbanLen, maxLength: bbanLen })
      .map((digits) => {
        const bban = digits.join("");
        return buildIban(country, bban);
      });
  });
}

// ---------------------------------------------------------------------------
// Helpers: SEPA-safe text generation
// ---------------------------------------------------------------------------

/**
 * Characters in the EPC217-08 SEPA allowed set (excluding control chars).
 * a-z A-Z 0-9 space / - ? : ( ) . , ' +
 */
const SEPA_CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /-?:().,'+";

/**
 * Arbitrary for a clean SEPA text string of the given max length.
 * All characters are from the allowed set, no leading/trailing spaces.
 */
function arbSepaText(minLen: number, maxLen: number): fc.Arbitrary<string> {
  return fc
    .stringOf(fc.constantFrom(...SEPA_CHARSET.split("")), {
      minLength: minLen,
      maxLength: maxLen,
    })
    .map((s) => s.trim())
    .filter((s) => s.length >= minLen);
}

/**
 * Arbitrary for a text string that may contain unicode/extended chars but
 * gets sanitized through sanitizeSepa before use.
 * Tests that sanitization always produces valid SEPA output.
 */
function arbSanitizedSepaText(minLen: number, maxLen: number): fc.Arbitrary<string> {
  // Mix of clean SEPA chars and common extended Latin
  const extendedChars = "äöüÄÖÜßàáâèéêìíîòóôùúûñç";
  const mixedCharset = SEPA_CHARSET + extendedChars;
  return fc
    .stringOf(fc.constantFrom(...mixedCharset.split("")), {
      minLength: minLen + 2,
      maxLength: maxLen + 10,
    })
    .map((s) => sanitizeSepa(s))
    .filter((s) => s.length >= minLen && s.length <= maxLen);
}

// ---------------------------------------------------------------------------
// Arbitraries: model components
// ---------------------------------------------------------------------------

function arbMessageId(): fc.Arbitrary<string> {
  return arbSepaText(1, 35);
}

function arbCreationDateTime(): fc.Arbitrary<string> {
  // Generate a valid ISO 8601 datetime
  return fc
    .record({
      year: fc.integer({ min: 2020, max: 2035 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }), // use 28 max to avoid month-end edge cases
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 0, max: 59 }),
      second: fc.integer({ min: 0, max: 59 }),
    })
    .map(
      ({ year, month, day, hour, minute, second }) =>
        `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}` +
        `T${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:${second.toString().padStart(2, "0")}Z`
    );
}

function arbExecutionDate(): fc.Arbitrary<string> {
  return fc
    .record({
      year: fc.integer({ min: 2024, max: 2035 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
    })
    .map(
      ({ year, month, day }) =>
        `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`
    );
}

function arbParty(): fc.Arbitrary<{ name: string }> {
  // Mix clean and sanitized names to stress-test the charset handling
  return fc.oneof(
    arbSepaText(1, 70).map((name) => ({ name })),
    arbSanitizedSepaText(1, 70).map((name) => ({ name }))
  );
}

function arbAmountMinorUnits(): fc.Arbitrary<bigint> {
  return fc.oneof(
    // Boundary: minimum (0.01 EUR = 1 cent)
    fc.constant(1n),
    // Boundary: exactly 1 EUR
    fc.constant(100n),
    // Boundary: large batch amounts
    fc.constant(999_999_999n),
    // Random amounts between 1 cent and 1 million EUR
    fc.bigInt({ min: 1n, max: 100_000_000n })
  );
}

function arbTransaction(): fc.Arbitrary<{
  endToEndId: string;
  amountMinorUnits: bigint;
  creditor: { name: string };
  creditorIban: string;
}> {
  return fc.record({
    endToEndId: arbSepaText(1, 35),
    amountMinorUnits: arbAmountMinorUnits(),
    creditor: arbParty(),
    creditorIban: arbIban(),
  });
}

function arbPaymentInstruction(): fc.Arbitrary<{
  paymentInfoId: string;
  requestedExecutionDate: string;
  debtor: { name: string };
  debtorIban: string;
  debtorAgent: { bic?: string };
  transactions: Array<{
    endToEndId: string;
    amountMinorUnits: bigint;
    creditor: { name: string };
    creditorIban: string;
  }>;
}> {
  return fc.record({
    paymentInfoId: arbSepaText(1, 35),
    requestedExecutionDate: arbExecutionDate(),
    debtor: arbParty(),
    debtorIban: arbIban(),
    // Sometimes include a BIC, sometimes leave empty (both are valid per XSD)
    debtorAgent: fc.oneof(
      fc.constant<{ bic?: string }>({}),
      fc.constant<{ bic?: string }>({ bic: "COBADEFFXXX" }),
      fc.constant<{ bic?: string }>({ bic: "BNPAFRPPXXX" }),
      fc.constant<{ bic?: string }>({ bic: "DEUTDEDBFRA" })
    ),
    // 1 to 5 transactions per payment instruction
    transactions: fc.array(arbTransaction(), { minLength: 1, maxLength: 5 }),
  });
}

function arbCreditTransferDocument(): fc.Arbitrary<CreditTransferDocument> {
  return fc.record({
    groupHeader: fc.record({
      messageId: arbMessageId(),
      creationDateTime: arbCreationDateTime(),
      initiatingParty: arbParty(),
    }),
    // 1 to 3 payment instructions
    paymentInstructions: fc.array(arbPaymentInstruction(), {
      minLength: 1,
      maxLength: 3,
    }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("XSD Oracle: pain.001.001.09", () => {
  // Smoke test: hand-built known-good model validates
  it("validates a hand-built sample model against the XSD", async () => {
    const doc: CreditTransferDocument = {
      groupHeader: {
        messageId: "SMOKE-TEST-001",
        creationDateTime: "2024-06-01T09:00:00Z",
        initiatingParty: { name: "Test Company GmbH" },
      },
      paymentInstructions: [
        {
          paymentInfoId: "PI-001",
          requestedExecutionDate: "2024-06-05",
          debtor: { name: "Test Company GmbH" },
          debtorIban: "DE89370400440532013000",
          debtorAgent: { bic: "COBADEFFXXX" },
          transactions: [
            {
              endToEndId: "E2E-0001",
              amountMinorUnits: 1n, // 0.01 EUR - minimum
              creditor: { name: "Supplier One" },
              creditorIban: "DE65200400300234567000",
            },
          ],
        },
      ],
    };

    const xml = writeCreditTransfer(doc);
    const result = await validateXsd(xml);

    expect(result.valid, `XSD errors: ${result.errors.join(", ")}`).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates a large-batch sample (10 transactions, 2 payment instructions)", async () => {
    const doc: CreditTransferDocument = {
      groupHeader: {
        messageId: "BATCH-TEST-001",
        creationDateTime: "2024-06-01T12:00:00Z",
        initiatingParty: { name: "Bulk Payer Corp" },
      },
      paymentInstructions: [
        {
          paymentInfoId: "PI-BATCH-001",
          requestedExecutionDate: "2024-06-10",
          debtor: { name: "Bulk Payer Corp" },
          debtorIban: "DE89370400440532013000",
          debtorAgent: {},
          transactions: Array.from({ length: 5 }, (_, i) => ({
            endToEndId: `E2E-BATCH-00${i + 1}`,
            amountMinorUnits: BigInt((i + 1) * 100),
            creditor: { name: `Creditor ${i + 1}` },
            creditorIban: "DE65200400300234567000",
          })),
        },
        {
          paymentInfoId: "PI-BATCH-002",
          requestedExecutionDate: "2024-06-11",
          debtor: { name: "Bulk Payer Corp" },
          debtorIban: "DE89370400440532013000",
          debtorAgent: { bic: "DEUTDEDBFRA" },
          transactions: Array.from({ length: 5 }, (_, i) => ({
            endToEndId: `E2E-BATCH-00${i + 6}`,
            amountMinorUnits: 999_999_99n,
            creditor: { name: `Large Payee ${i + 1}` },
            creditorIban: "DE65200400300234567000",
          })),
        },
      ],
    };

    const xml = writeCreditTransfer(doc);
    const result = await validateXsd(xml);

    expect(result.valid, `XSD errors: ${result.errors.join(", ")}`).toBe(true);
  });

  it("sanitizes unicode names and still produces valid XSD output", async () => {
    const doc: CreditTransferDocument = {
      groupHeader: {
        messageId: "UNICODE-TEST-01",
        creationDateTime: "2024-06-01T09:00:00Z",
        initiatingParty: { name: sanitizeSepa("Müller & Söhne GmbH") },
      },
      paymentInstructions: [
        {
          paymentInfoId: "PI-UNICODE-01",
          requestedExecutionDate: "2024-07-01",
          debtor: { name: sanitizeSepa("Schröder Überweisungen AG") },
          debtorIban: "DE89370400440532013000",
          debtorAgent: {},
          transactions: [
            {
              endToEndId: "E2E-UNICODE",
              amountMinorUnits: 5000n,
              creditor: { name: sanitizeSepa("Café Résumé Ñoño") },
              creditorIban: "DE65200400300234567000",
            },
          ],
        },
      ],
    };

    const xml = writeCreditTransfer(doc);
    const result = await validateXsd(xml);

    expect(result.valid, `XSD errors: ${result.errors.join(", ")}`).toBe(true);
  });

  // The core oracle property: every valid model produces XSD-valid XML
  it("property: forAll valid models, writeCreditTransfer produces XSD-valid XML (numRuns=200)", async () => {
    const failures: string[] = [];
    let runCount = 0;

    await fc.assert(
      fc.asyncProperty(arbCreditTransferDocument(), async (doc) => {
        runCount++;
        const xml = writeCreditTransfer(doc);
        const result = await validateXsd(xml);

        if (!result.valid) {
          failures.push(
            `Run ${runCount}: XSD error: ${result.errors.join(", ")}\nXML:\n${xml.slice(0, 500)}`
          );
        }

        return result.valid;
      }),
      {
        numRuns: 200,
        verbose: false,
        // Report counterexamples clearly
        reporter: ({ failed, counterexample, error }) => {
          if (failed) {
            throw new Error(
              `Property failed after ${runCount} runs.\n` +
                `Last failures:\n${failures.slice(-3).join("\n---\n")}\n` +
                `Counterexample: ${JSON.stringify(counterexample, (_, v) =>
                  typeof v === "bigint" ? v.toString() + "n" : v
                )}\n` +
                (error ? `Error: ${error}` : "")
            );
          }
        },
      }
    );

    // Confirm the property ran at least 200 times
    expect(runCount).toBeGreaterThanOrEqual(200);
  });
});
