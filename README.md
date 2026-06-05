# sepa-xml-ts

Type-safe SEPA payment files for TypeScript. **Parse, write, and validate** ISO 20022
`pain.001` credit transfers and `pain.008` direct debits behind a model that abstracts the
XML, with **every generated file validated against the official EPC/ISO 20022 XSD in CI**.

[![npm](https://img.shields.io/npm/v/sepa-xml-ts.svg)](https://www.npmjs.com/package/sepa-xml-ts)
[![CI](https://github.com/codewithagents/sepa-xml-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/codewithagents/sepa-xml-ts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![provenance](https://img.shields.io/badge/provenance-attested-success?logo=npm)](https://www.npmjs.com/package/sepa-xml-ts)
[![types](https://img.shields.io/badge/types-included-blue?logo=typescript)](https://www.npmjs.com/package/sepa-xml-ts)
[![install size](https://packagephobia.com/badge?p=sepa-xml-ts)](https://packagephobia.com/result?p=sepa-xml-ts)
[![codecov](https://codecov.io/gh/codewithagents/sepa-xml-ts/graph/badge.svg?branch=main)](https://codecov.io/gh/codewithagents/sepa-xml-ts)
[![tests](https://img.shields.io/badge/tests-668%20passing-success)](https://github.com/codewithagents/sepa-xml-ts/actions/workflows/ci.yml)
[![property-tested](https://img.shields.io/badge/property--tested-fast--check-blueviolet)](https://fast-check.dev)

> Status: stable. `1.0.0` is published with a frozen public API and semver guarantees. Output is verified against the official ISO 20022 XSD in CI.

## Table of contents

- [What it covers](#what-it-covers)
- [Why this exists](#why-this-exists)
- [How it compares](#how-it-compares)
- [The model, not the XML](#the-model-not-the-xml)
- [Install](#install)
- [Write](#write)
- [Parse](#parse)
- [Direct debit (pain.008)](#direct-debit-pain008)
- [Money](#money)
- [Advanced fields](#advanced-fields)
- [Bank profiles](#bank-profiles)
  - [The `requireBic` profile](#the-requirebic-profile)
  - [The `ibanBicCountryMatch` profile](#the-ibanbiccountrymatch-profile)
  - [Output options: batchBooking](#output-options-batchbooking)
  - [Authoring your own profile](#authoring-your-own-profile)
- [National variants](#national-variants)
  - [pain.001.001.03 (legacy ISO credit transfer)](#pain001001003-legacy-iso-credit-transfer)
  - [German DK variant: pain.001.003.03](#german-dk-variant-pain001003003)
  - [German DK variant: pain.008.003.02](#german-dk-variant-pain008003002)
- [Validate against the official XSD (optional)](#validate-against-the-official-xsd-optional)
- [API surface](#api-surface)
- [Scope](#scope)
- [License](#license)

## What it covers

What you can do today, what is planned, and what is deliberately out of scope. The library
is a payment-**file** library: it produces, reads, and validates ISO 20022 SEPA XML. It does
not talk to banks.

| Use case | Standard / format | Status |
|---|---|---|
| Write credit transfers to SEPA XML | `pain.001.001.09` | ✅ Supported |
| Write direct debits to SEPA XML | `pain.008.001.08` | ✅ Supported |
| Write German DK credit transfers | `pain.001.003.03` | ✅ Supported |
| Write German DK direct debits | `pain.008.003.02` | ✅ Supported |
| Write legacy ISO credit transfers | `pain.001.001.03` | ✅ Supported |
| Parse SEPA XML back to a typed model (auto-detects message type) | `pain.001` / `pain.008` | ✅ Supported |
| Read older coexistence direct debits | `pain.008.001.02` | ✅ Supported (read-only) |
| Validate business rules (IBAN mod-97, EPC charset, exact CtrlSum, dates) | all | ✅ Supported |
| Per-transaction amount cap and floor (EPC AT-06: 0.01 to 999,999,999.99 EUR) | all | ✅ Supported |
| Identifier slash rules (MsgId / PmtInfId / EndToEndId: no leading/trailing `/`, no `//`) | all | ✅ Supported |
| German Creditor Identifier length check (DE = exactly 18 chars) | direct debit | ✅ Supported |
| Validate XML against the official ISO 20022 / EPC XSD | all 6 schemas | ✅ Supported |
| SEPA Creditor Identifier check digits (ISO 7064 MOD 97-10) | direct debit | ✅ Supported |
| Bank profiles: extra rules plus minor output tweaks (e.g. `requireBic`, `ibanBicCountryMatch`, `batchBooking`) | overlay | ✅ Supported |
| pain.008 B2B specifics and sequence-type cross-field checks (R1/R2/R3/R4) | `pain.008` | ✅ Supported |
| Structured creditor/debtor postal address (`PstlAdr`) | all write variants (DK variants: `Ctry` + `AdrLine` only) | ✅ Supported |
| Ultimate creditor/debtor at transaction level (`UltmtCdtr` / `UltmtDbtr`, name + optional structured id OrgId/PrvtId) | `pain.001.001.09` / `pain.008.001.08` | ✅ Supported |
| Structured remittance / creditor reference (`RmtInf/Strd/CdtrRefInf`, conditional ISO 11649) | `pain.001.001.09` / `pain.008.001.08` | ✅ Supported |
| Purpose and category purpose codes (`Purp` / `CtgyPurp`, ISO external codes, not list-validated) | `pain.001.001.09` / `pain.008.001.08` | ✅ Supported |
| SDD mandate amendment (`AmdmntInd` + `AmdmntInfDtls`, incl. SMNDA, minimal fields) | `pain.008.001.08` | ✅ Supported |
| Further national write variants (e.g. Swiss `.ch`) | national `pain.001` / `pain.008` | 🟡 On request |
| Additional named bank profiles | overlay | 🟡 On request |
| Payment status reports | `pain.002` | ⛔ Out of scope |
| Account statements and reports | `camt.05x` | ⛔ Out of scope |
| Bank connectivity and file transmission | EBICS, FinTS/HBCI, Peppol | ⛔ Out of scope |
| Legacy pre-SEPA and SWIFT formats | DTAUS, SWIFT MT (MT103, MT940) | ⛔ Out of scope (deprecated) |
| Non-EUR or non-SEPA payment schemes | | ⛔ Out of scope |

Legend: ✅ available now, 🟡 planned or available on request, ⛔ not covered. Roadmap items are
demand-driven: a national variant only ships alongside that schema's official XSD and golden
samples, because a wrong flavor is worse than none.

Note on structured address: the EPC makes a structured `PstlAdr` (separate town, postcode, country
elements) mandatory for the modern messages from 15 November 2026, and many banks reject unstructured
addresses already. The optional `address` field on each party is emitted as a structured `PstlAdr` for
every write variant. The modern messages (`pain.001.001.09`, `pain.008.001.08`) and the legacy
`pain.001.001.03` (PostalAddress6) carry the full field set. The German DK variants
(`pain.001.003.03`, `pain.008.003.02`) use the restricted PostalAddressSEPA type, which supports only
`country` and up to two `addressLines`: any other field throws a clear error rather than being dropped
silently.

## Why this exists

A subtly wrong payments file is worse than no library. So correctness is the whole product,
and it is enforced, not hoped for:

- **Money cannot float.** Amounts are integer minor units (`bigint`), never JS `number` arithmetic.
- **CtrlSum is exact.** The control sum equals the sum of transfers with zero rounding tolerance.
- **SEPA character set enforced** (EPC217-08), as a concern separate from XML escaping.
- **IBANs validated by mod-97**, not just a regex.
- **SEPA Creditor Identifier check digits validated** (ISO 7064 MOD 97-10, with the business code
  excluded per EPC262-08). A creditor id that passes a regex but fails the check digit is caught
  before a file is ever emitted.
- **Dates are dates**, never timezone-stamped datetimes.
- **The model is anchored on the official XSD.** The test suite generates thousands of random
  valid models and asserts every serialized file validates against that XSD, and that every
  file parses back into the exact model it came from.
- **The parse path is fuzz-hardened.** It never throws: malformed input, entity injections, and
  DTD/DOCTYPE payloads all return a typed failure rather than raising an exception.

## How it compares

The table below is based on publicly available information and our own differential test suite
(see `test/differential.test.ts`). We run sepa.js and sepa-xml-ts against the same inputs and
compare their semantic output to verify compatible behavior.

| Feature | sepa-xml-ts | sepa (npm `sepa`, JS) | sepa_king (Ruby gem) |
|---|---|---|---|
| TypeScript types (built-in .d.ts, Zod model) | Yes | No (plain JS) | No (Ruby) |
| Write pain.001 credit transfers | Yes (.09, .03, DK .003.03) | Yes (.03 only) | Yes (.03, .001.03) |
| Write pain.008 direct debits | Yes (.08, DK .003.02) | No | Yes (.03.02) |
| Parse SEPA XML back to typed model | Yes (auto-detects message type) | No | No |
| Validate against the official ISO 20022 XSD | Yes (all 6 schemas, WASM) | No | No |
| Business rule validation (IBAN mod-97, EPC charset, exact CtrlSum) | Yes | Partial | Partial |
| Integer-only money (no float arithmetic) | Yes (bigint) | No (floats) | Yes (integer cents) |
| SEPA Creditor Identifier check digits (ISO 7064 MOD 97-10) | Yes | No | No |
| National variants (German DK pain.001.003.03 / pain.008.003.02) | Yes (with official XSD) | No | No |
| Bank profiles (overlay rules, e.g. requireBic) | Yes | No | No |
| Property-based + fuzz testing (fast-check, 200+ runs per suite) | Yes | No | No |
| npm provenance (OIDC Trusted Publishing, build attestation) | Yes | No | No |

sepa.js (npm package `sepa`, by philipp kewisch) is a solid pain.001.001.03 generator with a
simple API. sepa_king (Ruby) is a well-maintained pain.001/pain.008 library in the Ruby
ecosystem. Neither includes TypeScript types, parse/round-trip, or XSD validation
as first-class features.

## The model, not the XML

You work with a model that reads the way you think about a payment, not the way the XSD nests
its elements. A `Money` value instead of raw cents. A debtor or creditor is one `AccountParty`
(name, IBAN, optional BIC), not three sibling elements. A document is a few **batches**, each
a debit from one account on one date, each holding **transfers**. The library maps that to and
from valid `pain.001` XML for you, and derives `NbOfTxs` and `CtrlSum` so you never compute them
by hand.

```ts
import { euros, type CreditTransferDocument } from "sepa-xml-ts";

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

Every release is published to npm with provenance via OIDC Trusted Publishing, so you can
verify the build attestation on the npm package page.

## Write

`writeCreditTransfer` validates the model, computes `NbOfTxs` and `CtrlSum` with exact integer
arithmetic, and returns a `pain.001.001.09` XML string. It cannot emit a structurally invalid file.

```ts
import { euros, writeCreditTransfer, validateCreditTransfer } from "sepa-xml-ts";

// validateCreditTransfer() returns a typed result instead of throwing
const result = validateCreditTransfer(doc);
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
import { parse, MessageType } from "sepa-xml-ts";

const parsed = parse(xml);
if (!parsed.ok) {
  console.error(parsed.error);
} else if (parsed.type === MessageType.CreditTransfer) {
  // parsed.data is a CreditTransferDocument
  const total = parsed.data.batches
    .flatMap((b) => b.transfers)
    .reduce((sum, t) => sum + t.amount.minorUnits, 0n);
  console.log("credit transfer total:", total);
} else {
  // parsed.type === MessageType.DirectDebit -> parsed.data is a DirectDebitDocument
  console.log("collections:", parsed.data.batches.flatMap((b) => b.collections).length);
}
```

`MessageType.CreditTransfer` is `"pain.001"` and `MessageType.DirectDebit` is `"pain.008"`. Raw
string comparisons still type-check: `parsed.type === "pain.001"` is identical in behaviour and
the types are fully compatible.

The round-trip is anchored on the model: for any valid model,
`parse(write(model))` deep-equals the original. This is verified as a property test over thousands
of generated inputs, for both message types.

## Direct debit (pain.008)

In a direct debit scheme, one **creditor** (e.g. a subscription service or utility) collects
money directly from many **debtors** (customers), each of whom has signed a **mandate**
authorizing future collections. Unlike a credit transfer (where the payer pushes funds), a
direct debit pulls funds on the agreed collection date. The creditor holds the mandate and
presents it with every collection; the debtor's bank verifies the mandate and debits the
account. The SEPA Direct Debit (SDD) Core scheme is the standard used across the SEPA area.

`writeDirectDebit`
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

Note: `localInstrument` defaults to `CORE` when omitted.

`validateDirectDebit` and `writeDirectDebit` enforce four cross-field mandate rules from the SEPA
rulebook. R1: `mandate.signatureDate` must not be after the batch `collectionDate` (equal dates are
allowed). R2: a mandate id used in any OOFF batch must appear in exactly one collection across the
whole document. R3: a mandate id must not appear under both CORE and B2B local instruments in the
same document. R4: if any collection in a batch has `mandate.amendment.sameMandateNewDebtorAccount
=== true` (SMNDA, "same mandate, new debtor account at the same bank"), that batch's `sequenceType`
must be `FRST`.

### Mandate amendment (SMNDA)

When a debtor's bank account changes at the same bank (Same Mandate New Debtor Account), set
`mandate.amendment.sameMandateNewDebtorAccount: true` and place the collection in a `FRST` batch
(required by R4 and enforced by the writer):

```ts
import { euros, writeDirectDebit, type DirectDebitDocument } from "sepa-xml-ts";

const doc: DirectDebitDocument = {
  messageId: "DD-AMEND-001",
  createdAt: "2026-06-01T09:00:00Z",
  initiatingParty: "ACME GmbH",
  creditor: {
    name: "ACME GmbH",
    iban: "DE89370400440532013000",
    bic: "COBADEFFXXX",
    creditorId: "DE98ZZZ09999999999",
  },
  batches: [
    {
      id: "BATCH-SMNDA",
      collectionDate: "2026-06-20",
      sequenceType: "FRST", // R4: SMNDA requires FRST
      collections: [
        {
          endToEndId: "AMEND-001",
          amount: euros("49.99"),
          debtor: { name: "Kunde Eins", iban: "DE75512108001245126199" },
          mandate: {
            id: "MND-001",
            signatureDate: "2026-01-15",
            amendment: {
              // Debtor opened a new account at the same bank; old account not disclosed
              sameMandateNewDebtorAccount: true,
            },
          },
        },
      ],
    },
  ],
};

const xml = writeDirectDebit(doc);
// Emits AmdmntInd=true + OrgnlDbtrAgt/FinInstnId/Othr/Id=SMNDA
```

For other amendment scenarios (original mandate id change, original creditor scheme id, original
debtor account, original debtor agent BIC, original frequency, original final collection date,
original reason), set the corresponding optional fields on the `amendment` object.

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

## Advanced fields

Structured remittance, ultimate parties, postal address, and purpose codes are all optional
additive fields on `Transfer` (pain.001) and `Collection` (pain.008). The snippet below shows
all of them together on a credit transfer; the shapes are identical for direct debit collections.

```ts
import {
  euros,
  writeCreditTransfer,
  type CreditTransferDocument,
  type Transfer,
} from "sepa-xml-ts";

const transfer: Transfer = {
  endToEndId: "INV-2001",
  amount: euros("250.00"),
  creditor: {
    name: "Beispiel AG",
    iban: "NL91ABNA0417164300",
    // Optional structured postal address (mandatory from EPC 2026-11-22)
    address: {
      streetName: "Hauptstrasse",
      buildingNumber: "1",
      postCode: "10115",
      townName: "Berlin",
      country: "DE",
    },
  },
  // Ultimate creditor: the party who ultimately receives the funds (e.g. a factor)
  ultimateCreditor: {
    name: "Factor GmbH",
    // Optional structured id: OrgId XOR PrvtId
    id: { organisationId: { other: { id: "FACTOR-001" } } },
  },
  // Ultimate debtor: the party on whose behalf the payment is made
  ultimateDebtor: { name: "End Customer" },
  // Structured remittance (mutually exclusive with remittanceInfo)
  structuredRemittance: {
    creditorReference: "RF18539007547034", // ISO 11649 RF reference: check digits validated
    referenceType: "SCOR", // DocumentType3Code enum (RADM/RPIN/FXDR/DISP/PUOR/SCOR)
    // referredDocuments and referredDocumentAmount are also supported (see types)
  },
  // Purpose code: ISO external code (SALA, SUPP, etc.), 1-4 chars, not enum-validated
  purpose: "SUPP",
};

const doc: CreditTransferDocument = {
  messageId: "MSG-ADV-001",
  createdAt: "2026-06-01T10:30:00Z",
  initiatingParty: "ACME GmbH",
  batches: [
    {
      id: "BATCH-ADV-001",
      executionDate: "2026-06-03",
      debtor: { name: "ACME GmbH", iban: "DE89370400440532013000" },
      categoryPurpose: "SUPP", // batch-level category purpose (PmtTpInf/CtgyPurp)
      transfers: [transfer],
    },
  ],
};

const xml = writeCreditTransfer(doc);
```

Notes:
- `structuredRemittance` and `remittanceInfo` are mutually exclusive on the same transaction.
- `ultimateCreditor`, `ultimateDebtor`, structured remittance, and purpose codes are supported
  for `pain.001.001.09` and `pain.008.001.08` only. Legacy and DK variants throw if present.
- `address` is emitted as PostalAddress24 for the modern ISO variants and as PostalAddress6 for
  `pain.001.001.03`. DK variants support only `country` and up to two `addressLines`.

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

### The `ibanBicCountryMatch` profile

When a party has both an IBAN and a BIC, their country codes should normally match (e.g. a DE
IBAN paired with a BIC whose country code is also DE). A mismatch can indicate a data-entry
error. The `ibanBicCountryMatch` profile checks this for every party that has both.

This check is deliberately **opt-in** rather than a core rule. Several territories use a
different IBAN country code from the BIC country code for legitimate historical reasons:
French overseas departments and collectivities (GP, GF, MQ, RE, YT, PM, BL, MF) use IBANs
with their own country prefix but BICs registered under FR; British Crown Dependencies (GG, JE,
IM) have their own IBAN prefixes but BICs under GB. Encoding this as a core rule without a
complete and maintained exception table would risk false positives on valid files. The profile
ships with a documented exception table and you opt in when you know your bank performs this
check.

```ts
import {
  writeCreditTransfer,
  validateCreditTransfer,
  ibanBicCountryMatch,
} from "sepa-xml-ts";

const result = validateCreditTransfer(doc, { profile: ibanBicCountryMatch });
if (!result.ok) {
  console.error(result.profileIssues); // e.g. "IBAN country (DE) does not match BIC country (NL)"
}

const xml = writeCreditTransfer(doc, { profile: ibanBicCountryMatch });
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

## National variants

Some countries use national extensions of the SEPA schemas under different namespaces. These are
distinct from bank profiles: a profile is additive on top of an existing schema, while a national
variant is a different XML schema with its own element ordering and element names.

### pain.001.001.03 (legacy ISO credit transfer)

The legacy ISO credit transfer schema `pain.001.001.03` is supported as a write target for
systems that have not yet migrated to the modern `pain.001.001.09`. Pass `variant:
'pain.001.001.03'` (or the `CreditTransferVariant.SCT_Legacy` constant) to emit the older
namespace. The model input is the same `CreditTransferDocument`; only the serialization differs.

```ts
import { euros, writeCreditTransfer, CreditTransferVariant, type CreditTransferDocument } from "sepa-xml-ts";

const xml = writeCreditTransfer(doc, { variant: CreditTransferVariant.SCT_Legacy });
// equivalent to: writeCreditTransfer(doc, { variant: "pain.001.001.03" })
// <Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">...
```

Structural deltas from `pain.001.001.09`:
- `ReqdExctnDt` is a plain ISODate value (no `<Dt>` child wrapper, unlike the .09 `DateAndDateTime2Choice`)
- Agent elements use `<BIC>` element name (not `<BICFI>`)
- The debtor `FinInstnId` is always emitted at PmtInf level, even when `debtor.bic` is absent
  (an empty `<FinInstnId/>` is required by the .03 XSD)
- Ultimate parties, structured remittance, and purpose codes are not supported; the writer throws
  if any are present (no silent data loss)

### German DK variant: pain.001.003.03

The German DK (DFU agreement Anlage 3) uses the namespace
`urn:iso:std:iso:20022:tech:xsd:pain.001.003.03`. Pass `variant: 'pain.001.003.03'` (or the
`CreditTransferVariant.SCT_DK` constant) to emit and validate against this schema. The model
input is the same `CreditTransferDocument` for both variants; only the serialization differs.

```ts
import {
  euros,
  writeCreditTransfer,
  CreditTransferVariant,
  type CreditTransferDocument,
} from "sepa-xml-ts";
import { validateXsd } from "sepa-xml-ts/xsd";

const xml = writeCreditTransfer(doc, { variant: CreditTransferVariant.SCT_DK });
// equivalent to: writeCreditTransfer(doc, { variant: "pain.001.003.03" })
// <Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.003.03">...

const xsdResult = await validateXsd(xml); // validates against the DK XSD
console.log(xsdResult.valid); // true
```

The DK structural differences from pain.001.001.09:
- `ReqdExctnDt` is a plain ISODate value (no `<Dt>` child wrapper)
- `FinInstnId` uses `<BIC>` element name (not `<BICFI>`)
- `DbtrAgt` is required at PmtInf level: when `debtor.bic` is absent, the writer emits
  `<Othr><Id>NOTPROVIDED</Id></Othr>` (the only allowed fallback in the DK XSD)
- `CdtrAgt` is optional at transaction level: omitted when `creditor.bic` is absent

`parse()` also reads pain.001.003.03 into a `CreditTransferDocument` (type `"pain.001"`),
and `validateXsd()` uses the vendored DK XSD as the correctness oracle. Both are
verified in CI against the official DK XSD.

The `variant` and `profile` options can be combined:

```ts
const xml = writeCreditTransfer(doc, {
  variant: "pain.001.003.03",
  profile: { id: "my-bank", output: { batchBooking: true } },
});
```

### German DK variant: pain.008.003.02

The German DK direct debit variant uses the namespace
`urn:iso:std:iso:20022:tech:xsd:pain.008.003.02`. Pass `variant: 'pain.008.003.02'` (or the
`DirectDebitVariant.SDD_DK` constant) to emit and validate against this schema. The model input
is the same `DirectDebitDocument` for both variants; only the serialization differs.

```ts
import {
  euros,
  writeDirectDebit,
  DirectDebitVariant,
  type DirectDebitDocument,
} from "sepa-xml-ts";
import { validateXsd } from "sepa-xml-ts/xsd";

const xml = writeDirectDebit(doc, { variant: DirectDebitVariant.SDD_DK });
// equivalent to: writeDirectDebit(doc, { variant: "pain.008.003.02" })
// <Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.003.02">...

const xsdResult = await validateXsd(xml); // validates against the DK SDD XSD
console.log(xsdResult.valid); // true
```

The DK SDD structural differences from pain.008.001.08:
- `FinInstnId` uses `<BIC>` element name (not `<BICFI>`)
- `CdtrAgt` at PmtInf level: when `creditor.bic` is absent, the writer emits
  `<Othr><Id>NOTPROVIDED</Id></Othr>` (the only allowed fallback in the DK XSD)
- `DbtrAgt` at transaction level: same NOTPROVIDED fallback when `debtor.bic` is absent
- `GrpHdr` omits `CtrlSum` (optional in the DK XSD; reference sample omits it)

`parse()` reads pain.008.003.02 into a `DirectDebitDocument` (type `"pain.008"`),
and `validateXsd()` uses the vendored DK XSD as the correctness oracle.

The `variant` and `profile` options can be combined:

```ts
const xml = writeDirectDebit(doc, {
  variant: "pain.008.003.02",
  profile: { id: "my-bank", output: { batchBooking: true } },
});
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
| `PostalAddress`, `UltimateParty`, `PartyIdentification` | Optional party/address types (pain.001 + pain.008) |
| `StructuredRemittance`, `ReferenceType`, `ReferredDocument`, `RemittanceAmount` | Structured remittance types |
| `Purpose`, `CategoryPurpose` | Purpose and category-purpose types |
| `DirectDebitDocument`, `DirectDebitBatch`, `Collection`, `Creditor`, `Mandate`, `MandateAmendment`, `SequenceType`, `LocalInstrument` | pain.008 model types |
| `CreditTransferDocumentSchema`, `DirectDebitDocumentSchema` | The Zod schemas (single source of truth) |
| `euros(amount: string): Money` | Build a `Money` value safely |
| `formatMoney(m: Money): string` | Format a `Money` value to `"123.45"` |
| `writeCreditTransfer(model, options?): string` | Model to `pain.001` XML (`options.variant` selects schema) |
| `writeDirectDebit(model, options?): string` | Model to `pain.008` XML (`options.variant` selects schema) |
| `parse(xml: string): ParseResult` | SEPA XML to model, auto-detecting message type |
| `ParseResult`, `ParseSuccess001`, `ParseSuccess008`, `ParseFailure` | Discriminated union from `parse`. `ParseSuccess001` has `type: "pain.001"`, `ParseSuccess008` has `type: "pain.008"`. |
| `validateCreditTransfer(input, options?): ValidationResult` | Validate a credit-transfer model (schema + optional profile) |
| `validateDirectDebit(input, options?): DirectDebitValidationResult` | Validate a direct-debit model (schema + rules R1-R4 + optional profile) |
| `ValidationResult`, `ValidationSuccess`, `ValidationFailure` | Result types for `validateCreditTransfer` |
| `DirectDebitValidationResult`, `DirectDebitValidationSuccess`, `DirectDebitValidationFailure` | Result types for `validateDirectDebit` (adds `ruleIssues` for R1-R4 violations) |
| `ValidateOptions` | Options type for `validateCreditTransfer` / `validateDirectDebit` |
| `checkDirectDebitRules(doc): ProfileIssue[]` | Run the R1-R4 cross-field rule checks standalone |
| `WriteCreditTransferOptions` | Options type for `writeCreditTransfer` |
| `CreditTransferVariant` | `'pain.001.001.09' \| 'pain.001.001.03' \| 'pain.001.003.03'` |
| `WriteDirectDebitOptions` | Options type for `writeDirectDebit` |
| `DirectDebitVariant` | `'pain.008.001.08' \| 'pain.008.003.02'` |
| `BankProfile`, `ProfileIssue` | Types for authoring overlay bank profiles |
| `requireBic` | Built-in profile: requires a BIC on every agent |
| `ibanBicCountryMatch` | Built-in profile: opt-in IBAN vs BIC country consistency check |

From `sepa-xml-ts/xsd`:

| Export | Description |
|---|---|
| `validateXsd(xml: string): Promise<XsdResult>` | Validate XML against the official EPC XSD (all 6 supported schemas) |

Internal helpers (IBAN, SEPA charset, XML escaping) are intentionally not exported.

## Scope

- **Supported write+read+XSD-validate:** `pain.001.001.09`, `pain.001.001.03` (legacy ISO CT),
  `pain.001.003.03` (German DK CT variant), `pain.008.001.08`, and `pain.008.003.02` (German DK
  SDD variant).
- **Read-only (coexistence):** `pain.008.001.02`.
- **Out of scope:** bank connectivity / transmission (EBICS, FinTS, Peppol). This is a file library.

## License

MIT
