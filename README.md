# sepa-xml-ts

Type-safe SEPA payment files for TypeScript. Build, validate, and serialize ISO 20022
`pain.001` credit transfers, with **every generated file validated against the official
EPC/ISO 20022 XSD in CI**.

> Status: early (`0.x`). The public API may change before `1.0`. Scope today is
> pain.001.001.09 (SEPA Credit Transfer Initiation): build, validate, write.

## Why

A subtly wrong payments file is worse than no library. So correctness is the whole point:

- **Money cannot float.** Amounts are integer minor units (`bigint`), never JS `number` arithmetic.
- **CtrlSum is exact.** The control sum equals the sum of transactions with zero rounding tolerance.
- **SEPA character set enforced** (EPC217-08), separate from XML escaping.
- **IBANs checked by mod-97**, not just a regex.
- **Dates are dates**, not timezone-stamped datetimes.
- **The model is anchored on the official XSD**, and the test suite generates thousands of
  random valid models and asserts every serialized file validates against that XSD.

The Zod model is the single source of truth: you get runtime validation and inferred static
types from the same schema.

## Install

```sh
npm install sepa-xml-ts
```

## Usage

```ts
import { writeCreditTransfer, validate, type CreditTransferDocument } from "sepa-xml-ts";

const doc: CreditTransferDocument = {
  groupHeader: {
    messageId: "MSG-2026-0001",
    creationDateTime: "2026-06-01T10:30:00Z",
    initiatingParty: { name: "ACME GmbH" },
  },
  paymentInstructions: [
    {
      paymentInfoId: "PMT-0001",
      requestedExecutionDate: "2026-06-03", // a date, never a datetime
      debtor: { name: "ACME GmbH" },
      debtorIban: "DE89370400440532013000",
      debtorAgent: { bic: "COBADEFFXXX" },
      transactions: [
        {
          endToEndId: "INV-1001",
          amountMinorUnits: 12345n, // 123.45 EUR, in cents, as a bigint
          creditor: { name: "Beispiel AG" },
          creditorIban: "NL91ABNA0417164300",
        },
      ],
    },
  ],
};

// validate() returns a typed result instead of throwing
const result = validate(doc);
if (!result.ok) {
  console.error(result.errors);
} else {
  const xml = writeCreditTransfer(result.data); // pain.001.001.09 XML string
  console.log(xml);
}
```

`writeCreditTransfer` also self-validates the model and computes `NbOfTxs` and `CtrlSum`
for you, so it cannot emit a structurally invalid file.

### Optional: XSD validation

The XSD validator pulls a WASM blob, so it lives behind a subpath export and is lazy-loaded.
Write-only users never download it.

```ts
import { validateXsd } from "sepa-xml-ts/xsd";

const xsdResult = await validateXsd(xml);
if (!xsdResult.valid) {
  console.error(xsdResult.errors);
}
```

## Scope

- **Supported:** `pain.001.001.09` (SEPA Credit Transfer Initiation): model, validate, write.
- **Planned:** `pain.008` (direct debit), XML parsing (`XML to model`).
- **Out of scope:** bank connectivity / transmission (EBICS, FinTS). This is a file library.

## License

MIT
