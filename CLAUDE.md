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

- Now: `pain.001.001.09` (SEPA Credit Transfer Initiation). Parse, write, validate, XSD-validate.
- Planned: `pain.008` (direct debit, needs mandate sequence FRST/RCUR/OOFF/FNAL), reading older `pain.001.001.03`.
- Out: bank connectivity / transmission (EBICS, FinTS, Peppol).

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
- 0.2.0 (local, unpushed): natural model redesign (Money, AccountParty, batches/transfers,
  remittanceInfo) + parse + round-trip property test.
