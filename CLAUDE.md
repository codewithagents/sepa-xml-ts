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

- Write + parse + validate + XSD-validate: `pain.001.001.09` + `pain.008.001.08` (modern ISO),
  plus the German DK national variants `pain.001.003.03` + `pain.008.003.02`, plus the legacy ISO
  `pain.001.001.03` credit-transfer write target
  (writeCreditTransfer/writeDirectDebit take `{ variant }`). `parse` auto-detects the message type.
- Read-only coexistence: parse `pain.008.001.02` (write not supported); `validateXsd` covers all six schemas.
  Note `pain.001.001.03` is now a write target (see above), not read-only.
- SEPA Creditor Identifier check digits validated (ISO 7064 MOD 97-10, strict). Full EPC 217-08
  charset transliteration. SvcLvl/Cd=SEPA + ChrgBr=SLEV emitted on both message types.
- DK variant `pain.001.003.03` ships with XSD oracle at schemas/dk/ (DFU-Abkommen Anlage 3 v2.7).
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

`AccountParty = { name, iban, bic?, address? }` where `address` is an optional structured
`PostalAddress` (`PstlAdr`, PostalAddress24): `{ streetName?, buildingNumber?, postCode?, townName?,
countrySubDivision?, country? (2-letter), addressLines? (max 7) }`. Emitted only for .09/.08; the
legacy/DK variants THROW if an address is present (never silently dropped). The pain.008 `Creditor`
and collection `debtor` carry the same optional `address`. `Money = { currencyCode: "EUR", minorUnits: bigint }`,
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
- Amount range (EPC AT-06): 0.01 to 999,999,999.99 EUR per transaction, i.e. 1n to 99_999_999_999n minor units.
- Identifier slash rules: MsgId, PmtInfId, EndToEndId must not start/end with `/` nor contain `//` (NOT applied to mandate id or party names, per the EPC scope).
- SEPA charset EPC217-08 (a-z A-Z 0-9 space `/ - ? : ( ) . , ' +`), separate from XML escaping.
- IBAN by mod-97 checksum. BIC by format when present.
- SEPA Creditor Identifier: ISO 7064 MOD 97-10 with the business code (positions 5-7) EXCLUDED from the check (verified by test); German `DE` ids must be exactly 18 chars.
- Dates not datetimes for execution date.
- IBAN<->BIC country consistency is an OPT-IN profile (`ibanBicCountryMatch`), not a core rule, because the territory-exception list (French DOM-TOM, Channel Islands) would otherwise risk false positives.

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

- 0.1.0 and 0.2.0 published to npm (OIDC + provenance pipeline proven).
- Local, unpushed (next release will be 0.3.0): coexistence reading (.03/.02), SEPA rulebook
  elements on both types, dual validate, fuzz-hardened parse, complete EPC transliteration,
  golden corpus, differential tests vs sepa.js, bank-profile seam + requireBic, DK pain.001.003.03
  write+read variant.
- pain.008 sequence-type and mandate cross-field validation (R1/R2/R3) ships and is enforced by
  both validateDirectDebit (returns ruleIssues) and writeDirectDebit (throws before emitting XML).
  R1: signatureDate <= collectionDate. R2: OOFF mandate appears exactly once. R3: mandate id bound
  to one scheme (CORE or B2B) per document.
- Legacy ISO `pain.001.001.03` credit-transfer WRITE variant ships, XSD-verified against
  schemas/iso20022/pain.001.001.03.xsd (the same XSD already vendored for the read path), with
  XSD-oracle + round-trip property suites. Deltas vs .09: plain ReqdExctnDt, BIC not BICFI, debtor
  FinInstnId emitted (empty when no BIC). Teed up so CouponDude can later swap its hand-rolled .03
  string-building for the property-tested writer with no wire-format change.
- Standards-derived refinements ship (re-derived from the EPC rulebook, no third-party code copied):
  EPC AT-06 amount cap/floor on MoneySchema, identifier slash rules on MsgId/PmtInfId/EndToEndId,
  German DE Creditor Identifier = 18 chars, and a new opt-in `ibanBicCountryMatch` bank profile with
  a documented territory-exception table. A test proves the creditor-id check excludes the business
  code (positions 5-7) per EPC262-08. Deliberately NOT added: a "FRST before RCUR" rule (the SDD Core
  Rulebook made FRST optional in v9.1, so requiring it would be stricter than the standard).
- Structured postal address (PstlAdr) ships for pain.001.001.09 and pain.008.001.08: optional
  `address` on each party, emitted in PostalAddress24 element order (StrtNm, BldgNb, PstCd, TwnNm,
  CtrySubDvsn, Ctry, AdrLine), XSD-verified and round-trip tested. Absent address is byte-identical
  to before. Legacy/DK variants throw if an address is present (no silent data loss). EPC makes this
  mandatory on 2026-11-22. Follow-up: emit PstlAdr for the .03/DK variants too (their older
  PostalAddress types), and add Ultimate parties / Purpose / structured remittance.
- ~433 tests green: unit + golden + differential + the property suites (XSD-oracle and round-trip
  per type at 200 runs) + 3 parse fuzz suites at 300 runs + sequence-rules + iso003-variant +
  validation-rules + creditor-id + external-fixtures suites. Property arbitraries are constrained to
  satisfy the new rules by construction (amount cap, slash-free identifiers, globally-unique mandate
  ids), and the suite has been stress-run 15x with zero flakes.
- External cross-implementation fixtures live at test/fixtures/external/ (MIT samples from sepa_king:
  pain.001.001.03 + pain.001.003.03), parsed and run through the full pipeline to prove we read
  third-party XML. sepa_king's pain.008.003.02 sample was excluded because its placeholder creditor
  id DE00ZZZ00099999999 has check digits "00" (invalid under ISO 7064), which our validation correctly
  rejects: a useful confirmation our check-digit logic is right. See test/fixtures/external/NOTICE.md.
- Profile seam: write/validate take `{ profile, variant }`. variant 'pain.001.003.03' = DK national
  write target (XSD-verified against schemas/dk/). Built-in profiles: `requireBic`, `ibanBicCountryMatch`.
