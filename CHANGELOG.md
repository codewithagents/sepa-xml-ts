# Changelog

## [0.2.0](https://github.com/codewithagents/sepa-xml-ts/compare/sepa-xml-ts-v0.1.0...sepa-xml-ts-v0.2.0) (2026-06-01)


### Features

* add pain.008.001.08 SEPA Direct Debit support ([60101d7](https://github.com/codewithagents/sepa-xml-ts/commit/60101d7b6f459e23b1807bcd93d6bc583575f5d3))
* redesign model to AccountParty/Transfer/PaymentBatch, add Money type and parse() ([b0c0ab3](https://github.com/codewithagents/sepa-xml-ts/commit/b0c0ab389a78e39196f03ae3417ca62d839d6198))
* validate SEPA Creditor Identifier check digits (ISO 7064 MOD 97-10) ([fda7b05](https://github.com/codewithagents/sepa-xml-ts/commit/fda7b0511083f42524caa91e2a06ec2561642f95))


### Bug Fixes

* reject unknown namespaces in validateXsd instead of defaulting to pain.001 ([6729815](https://github.com/codewithagents/sepa-xml-ts/commit/6729815b55a1245d5de01fe53833e45914e75dd0))
