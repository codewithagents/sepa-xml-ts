# sepa-xml-ts

Type-safe SEPA payment-file library. Published to npm as `sepa-xml-ts` (unscoped, MIT).
Repo: `github.com/codewithagents/sepa-xml-ts`. A reputation play for the codewithagents brand:
**correctness is the entire product. A subtly wrong payments file is worse than none.**

> Style: never use em dashes. Use commas, colons, or periods.

## Goal

Three operations behind one type-safe model that abstracts the XML (does NOT mirror the XSD 1:1):
- **parse** SEPA XML to model
- **write** model to SEPA XML
- **validate** the model (business rules) and the XML (against the official XSD)

## Scope

- Write + parse + validate + XSD-validate: `pain.001.001.09` (credit transfer) and
  `pain.008.001.08` (direct debit). `parse` auto-detects the message type (discriminated union).
- Read-only coexistence: parse `pain.001.001.03` and `pain.008.001.02`; `validateXsd` covers all four.
- SEPA Creditor Identifier check digits validated (ISO 7064 MOD 97-10, strict). Full EPC 217-08
  charset transliteration. SvcLvl/Cd=SEPA + ChrgBr=SLEV emitted on both message types.
- Planned: German DK national write variant `pain.001.003.03` (XSD oracle at schemas/dk/).
- Out: bank connectivity / transmission (EBICS, FinTS, Peppol).

## Bank profiles (flavors)

A `BankProfile` is an OVERLAY on the always-correct core, never a fork: optional extra validation
(`checkCreditTransfer`/`checkDirectDebit` returning issues) plus minor additive output options
(e.g. `batchBooking`). write/validate take `{ profile }`; the writer throws if a profile check
fails so it cannot emit a file that violates the chosen profile. `requireBic` is the reference
profile. RULE: never ship a named/national flavor speculatively. National WRITE variants (different
output schema, e.g. DK pain.001.003.03) are a separate mechanism and only ship with that schema's
official XSD + golden samples. A wrong flavor is worse than none.

## Architecture

- One package, two entry points. `.` = model, writer, parser, business validation (the 90% path).
  `./xsd` = heavy XSD validation, lazy-loads `libxml2-wasm`, opt-in only.
- `package.json` has `sideEffects: false` and `files: [dist, schemas]` (the XSD ships and is
  loaded at runtime by `./xsd`, so it must be in the tarball).
- Zod is the single source of truth: model = schemas, business rules = refinements, types = `z.infer`.
- Curate the public surface by hand in `src/index.ts`. Keep IBAN/charset/escaper helpers internal.

## The model (public contract) and how it maps to the XSD

| Model | XSD |
|---|---|
| `CreditTransferDocument` | `Document/CstmrCdtTrfInitn` |
| `.messageId` | `GrpHdr/MsgId` |
| `.createdAt` (ISO datetime) | `GrpHdr/CreDtTm` |
| `.initiatingParty` (string) | `GrpHdr/InitgPty/Nm` |
| `.batches[]` | `PmtInf[]` |
| `PaymentBatch.id` | `PmtInfId` |
| `PaymentBatch.executionDate` (YYYY-MM-DD) | `ReqdExctnDt/Dt` (Dt, never DtTm) |
| `PaymentBatch.debtor` (`AccountParty`) | `Dbtr/Nm` + `DbtrAcct/Id/IBAN` + `DbtrAgt/FinInstnId/BICFI` |
| `PaymentBatch.transfers[]` | `CdtTrfTxInf[]` |
| `Transfer.endToEndId` | `PmtId/EndToEndId` |
| `Transfer.amount` (`Money`) | `Amt/InstdAmt` (`Ccy="EUR"`) |
| `Transfer.creditor` (`AccountParty`) | `Cdtr/Nm` + `CdtrAcct/Id/IBAN` + `CdtrAgt/FinInstnId/BICFI` |
| `Transfer.remittanceInfo?` | `RmtInf/Ustrd` |

`AccountParty = { name, iban, bic? }`. `Money = { currencyCode: "EUR", minorUnits: bigint }`,
built with `euros("123.45")`, formatted with `formatMoney`. Derived by the writer (not model
fields): `NbOfTxs`, `CtrlSum` (both levels), `PmtMtd=TRF`.

### pain.008 direct debit (the reverse: one creditor collects from many debtors)

| Model | XSD |
|---|---|
| `DirectDebitDocument` | `Document/CstmrDrctDbtInitn` |
| `.creditor` (`Creditor`, document-level; writer fans out into every PmtInf) | `Cdtr/Nm` + `CdtrAcct/Id/IBAN` + `CdtrAgt/FinInstnId/BICFI` + `CdtrSchmeId/Id/PrvtId/Othr/Id` (+ `SchmeNm/Prtry=SEPA`) |
| `Creditor.creditorId` | SEPA Creditor Identifier (format-validated only, check-digit is a TODO) |
| `.batches[]` (`DirectDebitBatch`) | `PmtInf[]` |
| `DirectDebitBatch.collectionDate` | `ReqdColltnDt/Dt` |
| `DirectDebitBatch.sequenceType` (FRST/RCUR/OOFF/FNAL) | `PmtTpInf/SeqTp` |
| `DirectDebitBatch.localInstrument?` (CORE/B2B, default CORE) | `PmtTpInf/LclInstrm/Cd` |
| `DirectDebitBatch.collections[]` (`Collection`) | `DrctDbtTxInf[]` |
| `Collection.amount` (`Money`) | `InstdAmt` (`Ccy="EUR"`) |
| `Collection.debtor` (`AccountParty`) | `Dbtr/Nm` + `DbtrAcct/Id/IBAN` + `DbtrAgt/FinInstnId/BICFI` |
| `Collection.mandate` (`{ id, signatureDate }`) | `DrctDbtTx/MndtRltdInf/MndtId` + `DtOfSgntr` |
| `Collection.remittanceInfo?` | `RmtInf/Ustrd` |

Writer-derived for pain.008: `NbOfTxs`, `CtrlSum` (both levels), `PmtMtd=DD`, `PmtTpInf/SvcLvl/Cd=SEPA`,
`ChrgBr=SLEV` (SEPA rulebook, optional in XSD). pain.008 gotchas: `CdtrAgt` (PmtInf) and `DbtrAgt`
(per tx) are STRUCTURALLY REQUIRED, so emit `<CdtrAgt><FinInstnId/></CdtrAgt>` even without a BIC.
`localInstrument` defaults to CORE on write, so arbitraries must set it explicitly to keep round-trip
deep-equal.

## Invariants (enforced as Zod refinements / internal helpers)

- No float money: amounts are `bigint` minor units. CtrlSum = exact sum, zero rounding tolerance.
- Amount format: exactly 2 decimals, dot separator, no grouping, `Ccy="EUR"`.
- SEPA charset EPC217-08 (a-z A-Z 0-9 space `/ - ? : ( ) . , ' +`), separate from XML escaping.
- IBAN by mod-97 checksum. BIC by format when present.
- Dates not datetimes for execution date.

## Testing strategy (the reputation lives here)

- XSD-as-oracle property test: any valid model -> write -> validates against the official XSD. numRuns >= 200.
- Round-trip property test: any valid model -> write -> parse -> deep-equals original. Anchor on the
  MODEL (model->XML->model), never XML->model->XML (formatting noise causes false failures). numRuns >= 200.
- fast-check arbitraries: mod-97-correct IBANs, nasty-unicode names that sanitize, boundary amounts
  (`euros("0.01")`, large batches), with/without bic and remittanceInfo.
- Official XSD lives at `schemas/iso20022/pain.001.001.09.xsd` (the ground truth; do not infer from samples).

## Dev workflow

- pnpm for dev (`pnpm install`, `pnpm build`, `pnpm test`, `pnpm typecheck`). `packageManager` is pinned.
- **Publish with npm, never pnpm** (only npm implements Trusted Publishing / `--provenance`; pnpm `pack`
  is needed only for monorepo `workspace:`/`catalog:` protocols, which this standalone package does not use).
- Pre-1.0: breaking model changes are fine. Commit messages are conventional (`feat:` -> minor, `fix:` -> patch).

## Release pipeline (GitHub Actions)

- `ci.yml`: typecheck, build, test on PR + push.
- `release.yml`: release-please (manifest mode, pinned to baseline, pre-1.0 minor/patch bumping) +
  npm Trusted Publishing via OIDC. The publish `if` compares `release_created == 'true'` explicitly
  (a non-empty string like "false" is truthy in GHA).
- First publish (0.1.0) was manual; subsequent releases go via OIDC once Trusted Publishing is configured
  on npmjs.org for the repo + `release.yml`.

## Current state

- 0.1.0 published to npm (write + validate, XSD-verified).
- Local, unpushed (working locally until mature; will be 0.2.0): natural model redesign (Money,
  AccountParty, batches/transfers, remittanceInfo), parse with model round-trip, and full
  pain.008 direct debit (model, writeDirectDebit, parse auto-detect, XSD-oracle + round-trip).
- 25 tests green: euros/formatMoney units, pain.001 + pain.008 sample tests, and four 200-run
  property tests (XSD-oracle + round-trip for each message type).
