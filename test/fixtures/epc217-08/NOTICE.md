# EPC217-08 SEPA conversion table

`conversion-table.json` holds the character mapping of the official SEPA conversion table
published by the European Payments Council. It is the source of truth for the library's
EPC217-08 character sets: `src/model/epc217-08-table.ts` is generated from it, and
`test/epc217-08-table.test.ts` fails when the two drift (regenerate with
`UPDATE_EPC217_08_TABLE=true pnpm vitest run test/epc217-08-table.test.ts`).

## Source

- Document: "EPC217-08 SEPA Conversion Table"
- File: `EPC217-08-SEPA-Conversion-Table.xls`
- URL: https://www.europeanpaymentscouncil.eu/sites/default/files/KB/files/EPC217-08-SEPA-Conversion-Table.xls
- sha256 of the downloaded file: `44d1bb47e3f47db6307e5db6828c73d29b31f2bc1a2d117303c04cdcb57be149`
- Companion paper: "EPC217-08 Best Practices SEPA Requirements for an Extended Character Set
  (UNICODE Subset)", version 1.1. Its sections 5 and 6 define how the table is used.

Source: European Payments Council (EPC AISBL), EPC217-08. The EPC authorises reproduction
for non-commercial purposes with acknowledgement of the source; this file is that
acknowledgement. The European Payments Council is not affiliated with this library and has
not reviewed it.

## What is vendored, and what is not

Only factual mapping data is committed, one entry per code point: the code point, the
character, its Unicode name, the set colour (column H), the basic conversion (columns D and
E) and the extended conversion (columns F and G). The two range rows (U+0460 to U+20AB and
U+20AD to U+10FFFF, both red, both converting to a full stop) are kept as `ranges`.

Not vendored: the `.xls` file itself, the PDF paper, the table's notes column and its
country column.

Extraction: every cell value and background colour of the sheet `Tabelle1` was read from the
`.xls`. Colour gives the set: yellow (255, 255, 0) is `basic`, green (153, 204, 0) is
`extended`, red (255, 0, 0) is `outside`. Column D `none` is stored as the character itself,
`N/A` as `null`, and the word `space` as a space. Invisible characters are stored as
`\uXXXX` escapes.

## Errata: Sign column versus code-point column

In 6 rows the table's Sign column (D) and its Resulting code point column (E) disagree, and
column E is plainly mistyped. The Sign column wins, and `test/epc217-08-table.test.ts` pins
exactly these rows:

| Code point | Character | Column D (Sign) | Column E (code point) | This library |
|---|---|---|---|---|
| U+00D0 | Ð | D | U+002E `.` | D |
| U+00DE | Þ | T | U+0062 `b` | TH (see decisions) |
| U+00F0 | ð | d | U+002E `.` | d |
| U+00FE | þ | t | U+0070 `p` | th (see decisions) |
| U+0125 | ĥ | h | U+0069 `i` | h |
| U+0127 | ħ | h | U+0069 `i` | h |

For U+0125 and U+0127 the extended columns (F and G) carry the same typo. Both characters
are red, so the extended target uses the basic conversion anyway.

## Decisions

- Thorn: the table's note on Þ says "sender should send TH". This library is the sender, so
  `toSepaCharset` converts Þ to `TH` and þ to `th`, not the Sign column's `T` and `t`.
- Section 6.2 sender rules override the table: & becomes `+` (the table says N/A), @ becomes
  `(at)` (the table says `.`), € becomes `E` and _ becomes `-` (both match the table).
- Anything without a conversion becomes a full stop (`.`), as section 6.1 prescribes for red
  entries: the N/A entries " < >, red entries without a letter conversion, both range rows,
  and code points the table does not list (C0 controls, lone surrogates). Nothing is dropped.
- Membership follows the colour column only. The apostrophe is green in the table but part of
  the basic Latin set of the EPC Implementation Guidelines (and section 3 of the paper), so it
  counts as basic.
- The extended (long-term) column is not used to rewrite green characters: U+00A0 NO-BREAK
  SPACE, Ŗ ŗ and the Cyrillic а е к о are green and stay as they are in extended text, even
  though column F suggests a basic look-alike.
- The German ae/oe/ue/ss convention is not part of EPC217-08 and is not applied: the table
  converts one to one (ä to a, ß to s).
- `toSepaCharset` normalizes to NFC before converting, so canonically equivalent input gives
  the same output. 7 red singleton entries normalize to another code point first: U+037E
  GREEK QUESTION MARK is canonically `;` and converts as `;` (to `,` in the basic target),
  and U+0344 becomes two combining marks (two full stops). The other 5 (U+0340, U+0341,
  U+0343, U+0374, U+0387) still give a full stop.

## Known table limits

- Section 6.1 of the paper names the plus-minus sign as part of the extended set, but the
  table colours ± (U+00B1) red. The table wins.
- Maltese Ġ ġ Ħ ħ are red although Malta is a SEPA country. They convert to G g H h.
- Typographic punctuation such as U+2019 RIGHT SINGLE QUOTATION MARK falls in the red range
  row and converts to a full stop. No extra typography mapping is applied, because it would be
  a convention without an EPC source.
