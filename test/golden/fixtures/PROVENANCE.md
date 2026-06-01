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
- **What it exercises:** A German national variant using the pain.001.003.03 namespace, which we
  intentionally do NOT support. Used to confirm graceful rejection: validateXsd returns
  valid=false with an unsupported-namespace error, and parse returns ok=false with an unknown
  namespace error.
