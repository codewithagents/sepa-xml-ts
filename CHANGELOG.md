# Changelog

## [1.0.0](https://github.com/codewithagents/sepa-xml-ts/compare/sepa-xml-ts-v0.5.0...sepa-xml-ts-v1.0.0) (2026-06-02)


### ⚠ BREAKING CHANGES

* removed the `validate` export (use `validateCreditTransfer`) and the deprecated `ParseSuccess` type (use `ParseSuccess001 | ParseSuccess008`).

### Features

* freeze public API for 1.0.0 ([bb6a7d1](https://github.com/codewithagents/sepa-xml-ts/commit/bb6a7d173fbf8211f80cf1e942accdd56b86dbc9))

## [0.5.0](https://github.com/codewithagents/sepa-xml-ts/compare/sepa-xml-ts-v0.4.0...sepa-xml-ts-v0.5.0) (2026-06-02)


### Features

* add EPC-derived validation refinements and ibanBicCountryMatch profile ([8898e42](https://github.com/codewithagents/sepa-xml-ts/commit/8898e42d128900a310fca33735f134d9702f81bf))
* add full AmdmntInfDtls fields to SDD mandate amendment ([#19](https://github.com/codewithagents/sepa-xml-ts/issues/19)) ([#22](https://github.com/codewithagents/sepa-xml-ts/issues/22)) ([bdac519](https://github.com/codewithagents/sepa-xml-ts/commit/bdac519371a95313315d403b60cd367ab78052d6))
* add pain.001.001.03 credit-transfer write variant (XSD-verified, legacy ISO format) ([73bba44](https://github.com/codewithagents/sepa-xml-ts/commit/73bba44f666ae319f072a5d82f8e10421d85b5c9))
* add proprietary (Prtry) purpose and category purpose ([#18](https://github.com/codewithagents/sepa-xml-ts/issues/18)) ([#21](https://github.com/codewithagents/sepa-xml-ts/issues/21)) ([d80a6dc](https://github.com/codewithagents/sepa-xml-ts/commit/d80a6dc37b148bded938ab03dc3de94dfba5f526))
* add Prtry reference type and RfrdDocInf/RfrdDocAmt to structured remittance ([#17](https://github.com/codewithagents/sepa-xml-ts/issues/17)) ([#23](https://github.com/codewithagents/sepa-xml-ts/issues/23)) ([645752c](https://github.com/codewithagents/sepa-xml-ts/commit/645752cbc69b636e8dfd6f38b6aa201ee7f63f0a))
* enforce pain.008 sequence-type and mandate cross-field rules (R1/R2/R3) ([28a435b](https://github.com/codewithagents/sepa-xml-ts/commit/28a435b7f33398ac2d85a3f08a1c7bba6a9e0b37))
* purpose codes (Purp/CtgyPurp) for pain.001.001.09 and pain.008.001.08 ([14376aa](https://github.com/codewithagents/sepa-xml-ts/commit/14376aad980d1d70f4eb6fb81abaeb8be6296140))
* SDD mandate amendment (AmdmntInd/AmdmntInfDtls + SMNDA) for pain.008.001.08 ([42fcf80](https://github.com/codewithagents/sepa-xml-ts/commit/42fcf8077200d256851491a7e21248ce697ac23b))
* structured Id on ultimate parties (UltmtDbtr/UltmtCdtr) ([#20](https://github.com/codewithagents/sepa-xml-ts/issues/20)) ([fa09664](https://github.com/codewithagents/sepa-xml-ts/commit/fa09664307492edbd152d5f49deba3138c7e8875))
* structured postal address (PstlAdr) for pain.001.001.09 and pain.008.001.08 ([a00d5e2](https://github.com/codewithagents/sepa-xml-ts/commit/a00d5e24885d5e237482479a8689dfccca305c2c))
* structured PstlAdr for legacy and DK write variants ([9fe02b2](https://github.com/codewithagents/sepa-xml-ts/commit/9fe02b25e09bed650b22f6fb4374d4afc5e9dcd6))
* structured remittance (RmtInf/Strd/CdtrRefInf) for pain.001.001.09 and pain.008.001.08 ([73e9de3](https://github.com/codewithagents/sepa-xml-ts/commit/73e9de3950bce7a676f2a36caa0adbdec159ef0b))
* ultimate parties (UltmtDbtr/UltmtCdtr) for pain.001.001.09 and pain.008.001.08 ([4733449](https://github.com/codewithagents/sepa-xml-ts/commit/4733449a3d1c76c13c4b6577bd08ac31e8259f76))


### Bug Fixes

* enforce IBAN minimum length and reject lowercase IBAN/creditor-id bodies ([#6](https://github.com/codewithagents/sepa-xml-ts/issues/6), [#7](https://github.com/codewithagents/sepa-xml-ts/issues/7)) ([#10](https://github.com/codewithagents/sepa-xml-ts/issues/10)) ([27555e1](https://github.com/codewithagents/sepa-xml-ts/commit/27555e143fad248b8ebc5710904ac507728af20f))
* reject DTD/DOCTYPE on parse path and anchor xmlns detection to root ([#12](https://github.com/codewithagents/sepa-xml-ts/issues/12), [#13](https://github.com/codewithagents/sepa-xml-ts/issues/13)) ([#14](https://github.com/codewithagents/sepa-xml-ts/issues/14)) ([dad1631](https://github.com/codewithagents/sepa-xml-ts/commit/dad163173eaa6750e3b3551997a693056d53180c))
* restore green CI on main (unused const + prettier drift) ([#9](https://github.com/codewithagents/sepa-xml-ts/issues/9)) ([71403e8](https://github.com/codewithagents/sepa-xml-ts/commit/71403e8ca05a666b31f0fca1f3a5595b1e59a0ed))

## [0.4.0](https://github.com/codewithagents/sepa-xml-ts/compare/sepa-xml-ts-v0.3.0...sepa-xml-ts-v0.4.0) (2026-06-01)


### Features

* add German DK pain.008.003.02 direct-debit write+read variant (XSD-verified) ([d76383e](https://github.com/codewithagents/sepa-xml-ts/commit/d76383e4c3e5ab98cd33aa70e399399a013a7a97))

## [0.3.0](https://github.com/codewithagents/sepa-xml-ts/compare/sepa-xml-ts-v0.2.0...sepa-xml-ts-v0.3.0) (2026-06-01)


### Features

* add bank-profile seam and require-bic reference profile ([db4616e](https://github.com/codewithagents/sepa-xml-ts/commit/db4616ecb91a4a74a759787bfbafdfab981cd1ee))
* add German DK pain.001.003.03 write+read variant (XSD-verified) ([52ad6ad](https://github.com/codewithagents/sepa-xml-ts/commit/52ad6adf1b23683a83d1e8e5bfeeacc10d0e1c08))
* add read-only coexistence support for pain.001.001.03 and pain.008.001.02 ([af293a8](https://github.com/codewithagents/sepa-xml-ts/commit/af293a85b7b075798c673d0b53448f2dcbcab2ac))
* add validateCreditTransfer and validateDirectDebit ([b6a1e37](https://github.com/codewithagents/sepa-xml-ts/commit/b6a1e3780e6c13e4f1f28e4ab3212ad28ddec51e))
* complete EPC 217-08 transliteration and broaden property generators ([a1ccbe9](https://github.com/codewithagents/sepa-xml-ts/commit/a1ccbe9edbe60cfe863abb6d0a297fb0d625a6ca))
* emit SEPA service level and charge bearer on credit transfers ([5d7c025](https://github.com/codewithagents/sepa-xml-ts/commit/5d7c025f1a165dd433153a06989c88916461c5e0))


### Bug Fixes

* make parse robust against malformed input (never throws) ([6ea6d5b](https://github.com/codewithagents/sepa-xml-ts/commit/6ea6d5b28bd9abfbebe606240f1656b59ce638d3))

## [0.2.0](https://github.com/codewithagents/sepa-xml-ts/compare/sepa-xml-ts-v0.1.0...sepa-xml-ts-v0.2.0) (2026-06-01)


### Features

* add pain.008.001.08 SEPA Direct Debit support ([60101d7](https://github.com/codewithagents/sepa-xml-ts/commit/60101d7b6f459e23b1807bcd93d6bc583575f5d3))
* redesign model to AccountParty/Transfer/PaymentBatch, add Money type and parse() ([b0c0ab3](https://github.com/codewithagents/sepa-xml-ts/commit/b0c0ab389a78e39196f03ae3417ca62d839d6198))
* validate SEPA Creditor Identifier check digits (ISO 7064 MOD 97-10) ([fda7b05](https://github.com/codewithagents/sepa-xml-ts/commit/fda7b0511083f42524caa91e2a06ec2561642f95))


### Bug Fixes

* reject unknown namespaces in validateXsd instead of defaulting to pain.001 ([6729815](https://github.com/codewithagents/sepa-xml-ts/commit/6729815b55a1245d5de01fe53833e45914e75dd0))
