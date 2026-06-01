# Golden Fixture Provenance

This directory contains vendored third-party SEPA XML samples used for golden-file testing.
All files are permissively licensed (MIT or Apache-2.0) and safe to redistribute with attribution.

## Files

### sepa_king.pain.001.001.03.xml

- **Source repo:** https://github.com/salesking/sepa_king
- **Upstream path:** spec/examples/pain.001.001.03.xml
- **License:** MIT
- **What it exercises:** A real pain.001.001.03 credit transfer with two transactions, a German
  debtor IBAN, and two creditor IBANs. Used to confirm that our parser handles the legacy
  pain.001.001.03 namespace (coexistence support) and that validateXsd accepts the document
  against the .03 XSD.

### pain001.pain.001.001.09.xml

- **Source repo:** https://github.com/sebastienrousseau/pain001
- **Upstream path:** pain001/templates/pain.001.001.09/pain.001.001.09.xml
- **License:** Apache-2.0
- **What it exercises:** A real pain.001.001.09 credit transfer that passes the official XSD
  schema (validateXsd returns valid=true) but contains at least one IBAN that fails the mod-97
  checksum. This demonstrates that XSD validation alone is insufficient: our library catches the
  bad IBAN at the model-validation layer (parse returns ok=false with an IBAN/mod-97 error). This
  is a key value-demonstration fixture.

### sepa_king.pain.001.003.03.xml

- **Source repo:** https://github.com/salesking/sepa_king
- **Upstream path:** spec/examples/pain.001.003.03.xml
- **License:** MIT
- **What it exercises:** A real pain.001.003.03 German DK credit transfer with two transactions.
  Used to confirm the DK CT variant is fully supported: validateXsd returns valid=true against
  the DK XSD oracle, and parse returns a CreditTransferDocument (type "pain.001").

### sepa_king.pain.008.003.02.xml

- **Source repo:** https://github.com/salesking/sepa_king
- **Upstream path:** spec/examples/pain.008.003.02.xml
- **License:** MIT
- **What it exercises:** A real pain.008.003.02 German DK direct debit with two transactions.
  Used to confirm the DK SDD variant is fully supported at the XSD level: validateXsd returns
  valid=true against the DK XSD oracle (schemas/dk/pain.008.003.02.xsd). The file contains a
  placeholder creditorId "DE00ZZZ00099999999" whose check digits fail ISO 7064 MOD 97-10, so
  parse() returns ok=false. This mirrors the pain001.pain.001.001.09.xml fixture: the XSD alone
  is not a sufficient correctness oracle. Raw XML content assertions (mandate id, sequenceType,
  debtor IBAN, amount, BIC element usage) are tested directly in test/dk-sdd-variant.test.ts.
