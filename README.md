# sepa-xml-ts

Type-safe SEPA payment files for TypeScript. **Parse, write, and validate** ISO 20022
`pain.001` credit transfers and `pain.008` direct debits behind a model that abstracts the
XML, with **every generated file validated against the official EPC/ISO 20022 XSD in CI**.

[![npm](https://img.shields.io/npm/v/sepa-xml-ts.svg)](https://www.npmjs.com/package/sepa-xml-ts)

> Status: early (`0.x`). The public API may still change before `1.0`. Scope today is
> `pain.001.001.09` (SEPA Credit Transfer Initiation) and `pain.008.001.08` (SEPA Direct
> Debit Initiation).

## Why this exists

A subtly wrong payments file is worse than no library. So correctness is the whole product,
and it is enforced, not hoped for:

- **Money cannot float.** Amounts are integer minor units (`bigint`), never JS `number` arithmetic.
- **CtrlSum is exact.** The control sum equals the sum of transfers with zero rounding tolerance.
- **SEPA character set enforced** (EPC217-08), as a concern separate from XML escaping.
- **IBANs validated by mod-97**, not just a regex.
- **Dates are dates**, never timezone-stamped datetimes.
- **The model is anchored on the official XSD.** The test suite generates thousands of random
  valid models and asserts every serialized file validates against that XSD, and that every
  file parses back into the exact model it came from.

## The model, not the XML

You work with a model that reads the way you think about a payment, not the way the XSD nests
its elements. A `Money` value instead of raw cents. A debtor or creditor is one `AccountParty`
(name, IBAN, optional BIC), not three sibling elements. A document is a few **batches**, each
a debit from one account on one date, each holding **transfers**. The library maps that to and
from valid `pain.001` XML for you, and derives `NbOfTxs` and `CtrlSum` so you never compute them
by hand.

```ts
import { CreditTransferDocument } from "sepa-xml-ts";

const doc: CreditTransferDocument = {
  messageId: "MSG-2026-0001",
  createdAt: "2026-06-01T10:30:00Z", // ISO datetime (GrpHdr/CreDtTm)
  initiatingParty: "ACME GmbH",
  batches: [
    {
      id: "BATCH-001",
      executionDate: "2026-06-03", // a date, never a datetime
      debtor: {
        name: "ACME GmbH",
        iban: "DE89370400440532013000",
        bic: "COBADEFFXXX",
      },
      transfers: [
        {
          endToEndId: "INV-1001",
          amount: euros("123.45"),
          creditor: { name: "Beispiel AG", iban: "NL91ABNA0417164300" },
          remittanceInfo: "Invoice 1001",
        },
      ],
    },
  ],
};
```

## Install

```sh
npm install sepa-xml-ts
# or: pnpm add sepa-xml-ts
```

ESM-only, ships its own type declarations. Node 18+.

## Write

`writeCreditTransfer` validates the model, computes `NbOfTxs` and `CtrlSum` with exact integer
arithmetic, and returns a `pain.001.001.09` XML string. It cannot emit a structurally invalid file.

```ts
import { euros, writeCreditTransfer, validate } from "sepa-xml-ts";

// validate() returns a typed result instead of throwing
const result = validate(doc);
if (!result.ok) {
  console.error(result.errors);
} else {
  const xml = writeCreditTransfer(result.data);
  console.log(xml); // <Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">...
}
```

## Parse

`parse` turns SEPA XML back into a model, reconstructing `Money` from the formatted amount. It
**auto-detects the message type** and returns a discriminated union, and never throws on malformed
input.

```ts
import { parse } from "sepa-xml-ts";

const parsed = parse(xml);
if (!parsed.ok) {
  console.error(parsed.error);
} else if (parsed.type === "pain.001") {
  // parsed.data is a CreditTransferDocument
  const total = parsed.data.batches
    .flatMap((b) => b.transfers)
    .reduce((sum, t) => sum + t.amount.minorUnits, 0n);
  console.log("credit transfer total:", total);
} else {
  // parsed.type === "pain.008" -> parsed.data is a DirectDebitDocument
  console.log("collections:", parsed.data.batches.flatMap((b) => b.collections).length);
}
```

The round-trip is anchored on the model: for any valid model,
`parse(write(model))` deep-equals the original. This is verified as a property test over thousands
of generated inputs, for both message types.

## Direct debit (pain.008)

Direct debit is the reverse of a credit transfer: one **creditor** collects money from many
**debtors**, each authorized by a **mandate**. The model mirrors that, and `writeDirectDebit`
emits valid `pain.008.001.08` XML (deriving `NbOfTxs`, `CtrlSum`, and fanning the creditor and
its SEPA Creditor Identifier into each batch for you).

```ts
import { euros, writeDirectDebit, type DirectDebitDocument } from "sepa-xml-ts";

const doc: DirectDebitDocument = {
  messageId: "DD-2026-0001",
  createdAt: "2026-06-01T09:00:00Z",
  initiatingParty: "ACME GmbH",
  creditor: {
    name: "ACME GmbH",
    iban: "DE89370400440532013000",
    bic: "COBADEFFXXX",
    creditorId: "DE98ZZZ09999999999", // SEPA Creditor Identifier
  },
  batches: [
    {
      id: "BATCH-001",
      collectionDate: "2026-06-10", // a date
      sequenceType: "FRST", // FRST | RCUR | OOFF | FNAL
      localInstrument: "CORE", // CORE | B2B (defaults to CORE)
      collections: [
        {
          endToEndId: "SUB-1001",
          amount: euros("49.99"),
          debtor: { name: "Kunde Eins", iban: "NL91ABNA0417164300" },
          mandate: { id: "MND-001", signatureDate: "2026-01-15" },
          remittanceInfo: "Subscription June",
        },
      ],
    },
  ],
};

const xml = writeDirectDebit(doc);
```

Note: the `creditorId` is validated for format and length today; the full SEPA Creditor Identifier
check-digit algorithm is a planned refinement. And `localInstrument` defaults to `CORE` when omitted.

## Money

`Money` is a first-class value, never a bare number. Construct it from a decimal **string** so a
float can never sneak in:

```ts
import { euros, formatMoney } from "sepa-xml-ts";

euros("123.45"); // { currencyCode: "EUR", minorUnits: 12345n }
euros("0.01"); // { currencyCode: "EUR", minorUnits: 1n }
euros("123.4"); // .4 is padded to .40 -> 12340n
euros("1.234"); // throws: more than 2 decimal places
euros("-1.00"); // throws: negative

formatMoney(euros("123.45")); // "123.45" (always 2 decimals, dot, no grouping)
```

## Bank profiles

A **bank profile** is an overlay: extra validation rules and optional minor output tweaks that
layer on top of the always-correct SEPA core. The model stays clean; the profile captures what
a specific bank requires beyond the XSD.

### What a profile is (and is not)

A profile is **additive**, not a replacement. It runs after base Zod validation, and it must
never make the output XSD-invalid. The output options that a profile may set (e.g. `batchBooking`)
are limited to elements the XSD already permits.

A profile is **not** a different message schema. Named national write-variant profiles
(different output schema, e.g. German pain.001.003.03 for DK/CAMT-DE) are a separate mechanism
and only ship alongside that schema's official XSD and golden test samples. A wrong flavor is
worse than none; do not use a profile to change the message type.

### The `requireBic` profile

Some banks reject IBAN-only files even though the SEPA XSD and the post-2016 SEPA rulebook
make BIC optional. The `requireBic` profile surfaces that rejection at validation time,
before submission.

```ts
import {
  writeCreditTransfer,
  validateCreditTransfer,
  requireBic,
} from "sepa-xml-ts";

// Validation: base Zod rules + profile rules, merged into one result
const result = validateCreditTransfer(doc, { profile: requireBic });
if (!result.ok) {
  // result.errors: Zod issues (schema)
  // result.profileIssues: bank-profile issues (e.g. missing BIC)
  console.error(result.errors, result.profileIssues);
}

// Writing: throws if either base validation or the profile check fails
const xml = writeCreditTransfer(doc, { profile: requireBic });
```

Same API for direct debit:

```ts
import { writeDirectDebit, validateDirectDebit, requireBic } from "sepa-xml-ts";

const result = validateDirectDebit(doc, { profile: requireBic });
const xml = writeDirectDebit(doc, { profile: requireBic });
```

### Output options: batchBooking

Profiles can also request minor output tweaks. The `batchBooking` option emits
`<BtchBookg>true</BtchBookg>` (or `false`) in each `PmtInf` element (XSD position: after
`PmtMtd`, before `NbOfTxs`). The output is still XSD-valid and the parser ignores the element
so the round-trip is unaffected.

```ts
import { writeCreditTransfer, type BankProfile } from "sepa-xml-ts";

const myBankProfile: BankProfile = {
  id: "my-bank",
  output: { batchBooking: true },
};

const xml = writeCreditTransfer(doc, { profile: myBankProfile });
// <BtchBookg>true</BtchBookg> now appears in every PmtInf
```

### Authoring your own profile

Implement the `BankProfile` interface. Return `ProfileIssue[]` from the check functions;
return an empty array to indicate the document passes. Use dot-delimited `path` values to
point at the offending field.

```ts
import type { BankProfile, ProfileIssue } from "sepa-xml-ts";

export const myProfile: BankProfile = {
  id: "my-bank-rules",
  description: "Extra rules required by My Bank AG",

  checkCreditTransfer(doc): ProfileIssue[] {
    const issues: ProfileIssue[] = [];
    for (const [bi, batch] of doc.batches.entries()) {
      if (batch.transfers.length > 100) {
        issues.push({
          path: `batches.${bi}.transfers`,
          message: "My Bank AG rejects batches with more than 100 transfers",
        });
      }
    }
    return issues;
  },
};
```

## Validate against the official XSD (optional)

Business rules (charset, IBAN, CtrlSum, dates) are already enforced by the model and the writer.
For belt-and-suspenders schema validation against the official EPC XSD, use the `./xsd` subpath.
It pulls a WASM blob, so it lives behind a separate entry point and is lazy-loaded: write-only
users never download it.

```ts
import { validateXsd } from "sepa-xml-ts/xsd";

const xsdResult = await validateXsd(xml);
if (!xsdResult.valid) {
  console.error(xsdResult.errors);
}
```

## API surface

From `sepa-xml-ts`:

| Export | Description |
|---|---|
| `CreditTransferDocument`, `PaymentBatch`, `Transfer`, `AccountParty`, `Money` | pain.001 model types |
| `DirectDebitDocument`, `DirectDebitBatch`, `Collection`, `Creditor`, `Mandate`, `SequenceType`, `LocalInstrument` | pain.008 model types |
| `CreditTransferDocumentSchema`, `DirectDebitDocumentSchema` | The Zod schemas (single source of truth) |
| `euros(amount: string): Money` | Build a `Money` value safely |
| `formatMoney(m: Money): string` | Format a `Money` value to `"123.45"` |
| `writeCreditTransfer(model): string` | Model to `pain.001` XML |
| `writeDirectDebit(model): string` | Model to `pain.008` XML |
| `parse(xml: string): ParseResult` | SEPA XML to model, auto-detecting message type |
| `validate(input: unknown): ValidationResult` | Validate a credit-transfer model against the schema |

From `sepa-xml-ts/xsd`:

| Export | Description |
|---|---|
| `validateXsd(xml: string): Promise<XsdResult>` | Validate XML against the official EPC XSD |

Internal helpers (IBAN, SEPA charset, XML escaping) are intentionally not exported.

## Scope

- **Supported:** `pain.001.001.09` (SEPA Credit Transfer Initiation) and `pain.008.001.08`
  (SEPA Direct Debit Initiation): parse, write, validate.
- **Planned:** the full SEPA Creditor Identifier check-digit, and reading the older
  `pain.001.001.03` / `pain.008.001.02` coexistence versions.
- **Out of scope:** bank connectivity / transmission (EBICS, FinTS, Peppol). This is a file library.

## License

MIT
