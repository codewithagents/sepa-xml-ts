# Changelog

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
