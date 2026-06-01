/**
 * Tests for sepa-xml-ts 0.2.0.
 *
 * Contains:
 * 1. Hand-written sample tests (smoke tests, euros/formatMoney helpers)
 * 2. XSD-oracle property test: for any valid model, write -> XSD-valid XML (numRuns >= 200)
 * 3. Round-trip property test: for any valid model, parse(write(model)) deep-equals original model (numRuns >= 200)
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fc from "fast-check";
import { writeCreditTransfer } from "../src/writer/writer.js";
import { parse } from "../src/parser/parser.js";
import { validateXsd } from "../src/xsd.js";
import { buildIban } from "../src/model/iban.js";
import { sanitizeSepa } from "../src/model/charset.js";
import { euros, formatMoney } from "../src/model/schema.js";
import type { CreditTransferDocument, AccountParty, Transfer, PaymentBatch } from "../src/model/schema.js";

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
 */
function arbSanitizedSepaText(minLen: number, maxLen: number): fc.Arbitrary<string> {
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

function arbCreatedAt(): fc.Arbitrary<string> {
  return fc
    .record({
      year: fc.integer({ min: 2020, max: 2035 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
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

function arbPartyName(): fc.Arbitrary<string> {
  return fc.oneof(
    arbSepaText(1, 70),
    arbSanitizedSepaText(1, 70)
  );
}

function arbBic(): fc.Arbitrary<string> {
  return fc.constantFrom(
    "COBADEFFXXX",
    "BNPAFRPPXXX",
    "DEUTDEDBFRA",
    "INGBNL2AXXX",
    "BSCHESMMXXX"
  );
}

function arbAccountParty(): fc.Arbitrary<AccountParty> {
  return fc.record({
    name: arbPartyName(),
    iban: arbIban(),
    bic: fc.option(arbBic(), { nil: undefined }),
  }).map((p) => {
    if (p.bic === undefined) {
      const { bic: _bic, ...rest } = p;
      return rest;
    }
    return p;
  });
}

function arbMoney(): fc.Arbitrary<{ currencyCode: "EUR"; minorUnits: bigint }> {
  return fc.oneof(
    // Boundary: minimum (0.01 EUR = 1 cent)
    fc.constant({ currencyCode: "EUR" as const, minorUnits: 1n }),
    // Boundary: exactly 1 EUR
    fc.constant({ currencyCode: "EUR" as const, minorUnits: 100n }),
    // Boundary: large amount
    fc.constant({ currencyCode: "EUR" as const, minorUnits: 999_999_999n }),
    // Random amounts between 1 cent and 1 million EUR
    fc.bigInt({ min: 1n, max: 100_000_000n }).map((n) => ({ currencyCode: "EUR" as const, minorUnits: n }))
  );
}

function arbTransfer(): fc.Arbitrary<Transfer> {
  return fc.record({
    endToEndId: arbSepaText(1, 35),
    amount: arbMoney(),
    creditor: arbAccountParty(),
    remittanceInfo: fc.option(arbSepaText(1, 140), { nil: undefined }),
  }).map((tx) => {
    if (tx.remittanceInfo === undefined) {
      const { remittanceInfo: _ri, ...rest } = tx;
      return rest;
    }
    return tx;
  });
}

function arbPaymentBatch(): fc.Arbitrary<PaymentBatch> {
  return fc.record({
    id: arbSepaText(1, 35),
    executionDate: arbExecutionDate(),
    debtor: arbAccountParty(),
    transfers: fc.array(arbTransfer(), { minLength: 1, maxLength: 5 }),
  });
}

function arbCreditTransferDocument(): fc.Arbitrary<CreditTransferDocument> {
  return fc.record({
    messageId: arbMessageId(),
    createdAt: arbCreatedAt(),
    initiatingParty: arbPartyName(),
    batches: fc.array(arbPaymentBatch(), { minLength: 1, maxLength: 3 }),
  });
}

// ---------------------------------------------------------------------------
// Hand-written sample tests
// ---------------------------------------------------------------------------

describe("euros() and formatMoney() helpers", () => {
  it("euros('0.01') produces minorUnits = 1n", () => {
    const m = euros("0.01");
    expect(m.currencyCode).toBe("EUR");
    expect(m.minorUnits).toBe(1n);
  });

  it("euros('123.45') produces minorUnits = 12345n", () => {
    const m = euros("123.45");
    expect(m.minorUnits).toBe(12345n);
  });

  it("euros('123.4') treats single decimal as x0 (1240n)", () => {
    const m = euros("123.4");
    expect(m.minorUnits).toBe(12340n);
  });

  it("euros('123') treats integer string as whole euros (12300n)", () => {
    const m = euros("123");
    expect(m.minorUnits).toBe(12300n);
  });

  it("euros('0.00') throws because amount is below minimum", () => {
    expect(() => euros("0.00")).toThrow();
  });

  it("euros('') throws on empty string", () => {
    expect(() => euros("")).toThrow();
  });

  it("euros('1.234') throws on more than 2 decimal places", () => {
    expect(() => euros("1.234")).toThrow();
  });

  it("euros('-1.00') throws on negative string", () => {
    expect(() => euros("-1.00")).toThrow();
  });

  it("euros('abc') throws on non-numeric string", () => {
    expect(() => euros("abc")).toThrow();
  });

  it("formatMoney round-trips with euros()", () => {
    const m = euros("50.75");
    expect(formatMoney(m)).toBe("50.75");
  });

  it("formatMoney always produces exactly 2 decimal places", () => {
    const m = euros("100");
    expect(formatMoney(m)).toBe("100.00");
  });

  it("formatMoney on minimum amount produces '0.01'", () => {
    const m = euros("0.01");
    expect(formatMoney(m)).toBe("0.01");
  });
});

// ---------------------------------------------------------------------------
// Hand-written sample: model -> write -> XSD-valid AND parse -> deep-equal
// ---------------------------------------------------------------------------

describe("Sample model: write XSD validity and parse round-trip", () => {
  const sampleDoc: CreditTransferDocument = {
    messageId: "MSG-SAMPLE-001",
    createdAt: "2024-06-01T09:00:00Z",
    initiatingParty: "Test Company GmbH",
    batches: [
      {
        id: "BATCH-001",
        executionDate: "2024-06-05",
        debtor: {
          name: "Test Company GmbH",
          iban: "DE89370400440532013000",
          bic: "COBADEFFXXX",
        },
        transfers: [
          {
            endToEndId: "E2E-0001",
            amount: euros("0.01"),
            creditor: {
              name: "Supplier One",
              iban: "DE65200400300234567000",
            },
          },
          {
            endToEndId: "E2E-0002",
            amount: euros("123.45"),
            creditor: {
              name: "Supplier Two",
              iban: "DE65200400300234567000",
              bic: "DEUTDEDBFRA",
            },
            remittanceInfo: "Invoice 2024/42",
          },
        ],
      },
      {
        id: "BATCH-002",
        executionDate: "2024-06-10",
        debtor: {
          name: "Test Company GmbH",
          iban: "DE89370400440532013000",
        },
        transfers: [
          {
            endToEndId: "E2E-0003",
            amount: euros("999.99"),
            creditor: {
              name: "Large Vendor",
              iban: "FR7630006000011234567890189",
            },
            remittanceInfo: "Payment for services",
          },
        ],
      },
    ],
  };

  it("write produces XSD-valid XML", async () => {
    const xml = writeCreditTransfer(sampleDoc);
    const result = await validateXsd(xml);
    expect(result.valid, `XSD errors: ${result.errors.join(", ")}`).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("parse(write(model)) deep-equals the original model", () => {
    const xml = writeCreditTransfer(sampleDoc);
    const parsed = parse(xml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("parse failed: " + (parsed as { error: string }).error);
    expect(parsed.data).toEqual(sampleDoc);
  });

  it("sanitizes unicode names and still produces valid XSD output", async () => {
    const doc: CreditTransferDocument = {
      messageId: "UNICODE-TEST-01",
      createdAt: "2024-06-01T09:00:00Z",
      initiatingParty: sanitizeSepa("Müller und Söhne GmbH"),
      batches: [
        {
          id: "PI-UNICODE-01",
          executionDate: "2024-07-01",
          debtor: {
            name: sanitizeSepa("Schroeder Ueberweisungen AG"),
            iban: "DE89370400440532013000",
          },
          transfers: [
            {
              endToEndId: "E2E-UNICODE",
              amount: euros("50.00"),
              creditor: {
                name: sanitizeSepa("Cafe Resume Nonyo"),
                iban: "DE65200400300234567000",
              },
            },
          ],
        },
      ],
    };

    const xml = writeCreditTransfer(doc);
    const result = await validateXsd(xml);
    expect(result.valid, `XSD errors: ${result.errors.join(", ")}`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// XSD Oracle property test
// ---------------------------------------------------------------------------

describe("XSD Oracle: pain.001.001.09", () => {
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

    expect(runCount).toBeGreaterThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// Round-trip property test: model -> write -> parse -> deep-equal
// ---------------------------------------------------------------------------

describe("Round-trip: model -> write -> parse -> deep-equal (numRuns=200)", () => {
  it("property: forAll valid models, parse(writeCreditTransfer(model)) deep-equals original (numRuns=200)", () => {
    let runCount = 0;

    fc.assert(
      fc.property(arbCreditTransferDocument(), (doc) => {
        runCount++;
        const xml = writeCreditTransfer(doc);
        const result = parse(xml);

        if (!result.ok) {
          throw new Error(
            `parse() failed on valid model at run ${runCount}: ${result.error}\nXML:\n${xml.slice(0, 500)}`
          );
        }

        // Deep-equal check
        expect(result.data).toEqual(doc);
        return true;
      }),
      {
        numRuns: 200,
        verbose: false,
      }
    );

    expect(runCount).toBeGreaterThanOrEqual(200);
  });
});
