# sepa-xml-ts

Type-safe SEPA payment files for TypeScript. **Parse, write, and validate** ISO 20022
`pain.001` credit transfers behind a model that abstracts the XML, with **every generated
file validated against the official EPC/ISO 20022 XSD in CI**.

[![npm](https://img.shields.io/npm/v/sepa-xml-ts.svg)](https://www.npmjs.com/package/sepa-xml-ts)

> Status: early (`0.x`). The public API may still change before `1.0`. Today's scope is
> `pain.001.001.09` (SEPA Credit Transfer Initiation).

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

`parse` turns a `pain.001.001.09` XML string back into the same model, including reconstructing
`Money` from the formatted amount. It returns a typed result and never throws on malformed input.

```ts
import { parse } from "sepa-xml-ts";

const parsed = parse(xml);
if (parsed.ok) {
  const total = parsed.data.batches
    .flatMap((b) => b.transfers)
    .reduce((sum, t) => sum + t.amount.minorUnits, 0n);
  console.log("total minor units:", total);
} else {
  console.error(parsed.error);
}
```

The round-trip is anchored on the model: for any valid model,
`parse(writeCreditTransfer(model))` deep-equals the original. This is verified as a property
test over thousands of generated inputs.

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
| `CreditTransferDocument`, `PaymentBatch`, `Transfer`, `AccountParty`, `Money` | Model types |
| `CreditTransferDocumentSchema` | The Zod schema (single source of truth) |
| `euros(amount: string): Money` | Build a `Money` value safely |
| `formatMoney(m: Money): string` | Format a `Money` value to `"123.45"` |
| `writeCreditTransfer(model): string` | Model to `pain.001` XML |
| `parse(xml: string): ParseResult` | `pain.001` XML to model |
| `validate(input: unknown): ValidationResult` | Validate against the schema |

From `sepa-xml-ts/xsd`:

| Export | Description |
|---|---|
| `validateXsd(xml: string): Promise<XsdResult>` | Validate XML against the official EPC XSD |

Internal helpers (IBAN, SEPA charset, XML escaping) are intentionally not exported.

## Scope

- **Supported:** `pain.001.001.09` (SEPA Credit Transfer Initiation): parse, write, validate.
- **Planned:** `pain.008` (direct debit), and reading older `pain.001.001.03`.
- **Out of scope:** bank connectivity / transmission (EBICS, FinTS, Peppol). This is a file library.

## License

MIT
