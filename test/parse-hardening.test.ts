/**
 * Tests for Issue #12 (DOCTYPE/DTD rejection) and Issue #13 (xmlns anchored to Document root).
 *
 * Issue #12: Any input containing a DOCTYPE declaration must be rejected by
 *   both parse() and validateXsd() before reaching the XML parser.
 *
 * Issue #13: The xmlns namespace is detected from the <Document> root element
 *   only. A fake xmlns inside an XML comment before the root must not steer
 *   namespace detection.
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { XmlDocument, XmlParseError, ParseOption } from 'libxml2-wasm'
import { parse, type ParseOptions } from '../src/parser/parser.js'
import { decodeReferences } from '../src/xml-references.js'
import { findWellFormednessProblem } from '../src/xml-wellformedness.js'
import { detectSepaNamespace } from '../src/xmlns-detect.js'
import { validateXsd } from '../src/xsd.js'
import { writeCreditTransfer } from '../src/writer/writer.js'
import { writeDirectDebit } from '../src/writer/direct-debit.js'
import { euros } from '../src/model/schema.js'
import type { CreditTransferDocument } from '../src/model/schema.js'
import type { DirectDebitDocument } from '../src/model/pain008.js'

// ---------------------------------------------------------------------------
// Minimal valid fixtures
// ---------------------------------------------------------------------------

const NS_PAIN001 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09'
const NS_UNKNOWN = 'urn:example:unknown'

const MINIMAL_CT: CreditTransferDocument = {
  messageId: 'HARDEN-CT-001',
  createdAt: '2024-06-01T09:00:00Z',
  initiatingParty: 'Test Initiator',
  batches: [
    {
      id: 'BATCH-001',
      executionDate: '2024-06-05',
      debtor: {
        name: 'Test Debtor',
        iban: 'DE89370400440532013000',
        bic: 'COBADEFFXXX',
      },
      transfers: [
        {
          endToEndId: 'E2E-0001',
          amount: euros('1.00'),
          creditor: {
            name: 'Test Creditor',
            iban: 'DE65200400300234567000',
          },
        },
      ],
    },
  ],
}

const MINIMAL_DD: DirectDebitDocument = {
  messageId: 'HARDEN-DD-001',
  createdAt: '2024-06-01T09:00:00Z',
  initiatingParty: 'Test Initiator',
  creditor: {
    name: 'Test Creditor',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX',
    creditorId: 'DE98ZZZ09999999999',
  },
  batches: [
    {
      id: 'SDD-BATCH-001',
      collectionDate: '2024-07-05',
      sequenceType: 'FRST',
      localInstrument: 'CORE',
      collections: [
        {
          endToEndId: 'SDD-E2E-0001',
          amount: euros('1.00'),
          debtor: {
            name: 'Test Debtor',
            iban: 'DE65200400300234567000',
          },
          mandate: {
            id: 'MAND-0001',
            signatureDate: '2024-01-15',
          },
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Issue #12: DOCTYPE/DTD rejection
// ---------------------------------------------------------------------------

describe('parse() DOCTYPE rejection (Issue #12)', () => {
  it('rejects a document with a simple DOCTYPE declaration', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo>
<Document xmlns="${NS_PAIN001}"><CstmrCdtTrfInitn/></Document>`
    const result = parse(xml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toMatch(/DOCTYPE|DTD/i)
  })

  it('rejects a document with a DOCTYPE and an internal subset containing an entity', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY x "PWNED">
]>
<Document xmlns="${NS_PAIN001}"><CstmrCdtTrfInitn>&x;</CstmrCdtTrfInitn></Document>`
    const result = parse(xml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toMatch(/DOCTYPE|DTD/i)
  })

  it('rejects a DOCTYPE with mixed case (e.g. <!doctype)', () => {
    const xml = `<?xml version="1.0"?>
<!doctype foo>
<Document xmlns="${NS_PAIN001}"><CstmrCdtTrfInitn/></Document>`
    const result = parse(xml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toMatch(/DOCTYPE|DTD/i)
  })
})

describe('validateXsd() DOCTYPE rejection (Issue #12)', () => {
  it('rejects a document with a simple DOCTYPE declaration', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo>
<Document xmlns="${NS_PAIN001}"><CstmrCdtTrfInitn/></Document>`
    const result = await validateXsd(xml)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toMatch(/DOCTYPE|DTD/i)
  })

  it('rejects a document with an internal subset containing an entity', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe "PWNED">
]>
<Document xmlns="${NS_PAIN001}"><CstmrCdtTrfInitn>&xxe;</CstmrCdtTrfInitn></Document>`
    const result = await validateXsd(xml)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toMatch(/DOCTYPE|DTD/i)
  })
})

// ---------------------------------------------------------------------------
// Issue #12 regression: standard entity escaping must still work
// ---------------------------------------------------------------------------

describe('standard escaped entities still parse correctly (Issue #12 regression)', () => {
  it('a party name with &apos; in the XML still decodes to an apostrophe', () => {
    // The apostrophe is the only XML-escapable character that is also valid in
    // the SEPA charset (& < > " are all outside it), so it is the right probe
    // to prove the DOCTYPE guard did not break standard entity decoding.
    const validXml = writeCreditTransfer(MINIMAL_CT)
    const withApos = validXml.replace('<Nm>Test Creditor</Nm>', '<Nm>O&apos;Brien Trading</Nm>')

    // The injected XML carries a standard entity, not a DOCTYPE.
    expect(withApos).toContain('&apos;')
    expect(withApos).not.toMatch(/<!DOCTYPE/i)

    const result = parse(withApos)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true, got: ' + result.error)
    expect(result.type).toBe('pain.001')
    // &apos; must have been decoded back to a literal apostrophe.
    expect(result.data.batches[0].transfers[0].creditor.name).toBe("O'Brien Trading")
  })

  it('a party name with &lt; and &gt; in the XML still parses correctly', () => {
    // The SEPA charset does not include < or >, so the writer replaces them.
    // We inject them directly into the XML to test the entity path.
    const validXml = writeCreditTransfer(MINIMAL_CT)
    // Replace the creditor name with an escaped angle bracket variant
    const withLtGt = validXml.replace('<Nm>Test Creditor</Nm>', '<Nm>Test &lt;Creditor&gt;</Nm>')
    const result = parse(withLtGt)
    // It may fail model validation (charset), but it must NOT throw
    expect(() => parse(withLtGt)).not.toThrow()
    expect(typeof result.ok).toBe('boolean')
  })

  it('valid pain.001 XML round-trips correctly after DOCTYPE guard is in place', () => {
    const xml = writeCreditTransfer(MINIMAL_CT)
    const result = parse(xml)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true, got: ' + result.error)
    if (result.type !== 'pain.001') throw new Error('expected type pain.001')
    expect(result.data).toEqual(MINIMAL_CT)
  })

  it('valid pain.008 XML round-trips correctly after DOCTYPE guard is in place', () => {
    const xml = writeDirectDebit(MINIMAL_DD)
    const result = parse(xml)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true, got: ' + result.error)
    if (result.type !== 'pain.008') throw new Error('expected type pain.008')
    expect(result.data).toEqual(MINIMAL_DD)
  })
})

// ---------------------------------------------------------------------------
// Issue #13: xmlns anchored to <Document> root (comment-steering prevention)
// ---------------------------------------------------------------------------

describe('xmlns detection anchored to <Document> root (Issue #13)', () => {
  it('a fake xmlns in an XML comment before the Document tag is ignored', () => {
    // Attacker inserts a comment with a bogus namespace before the real root.
    // With the old first-match regex this would have returned NS_UNKNOWN.
    // With the anchored regex it must use the real Document xmlns.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- xmlns="${NS_UNKNOWN}" this is a comment, not a namespace declaration -->
<Document xmlns="${NS_PAIN001}">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>HARDEN-001</MsgId>
      <CreDtTm>2024-06-01T09:00:00Z</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>1.00</CtrlSum>
      <InitgPty><Nm>Test</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>B1</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>1.00</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt><Dt>2024-06-05</Dt></ReqdExctnDt>
      <Dbtr><Nm>Test Debtor</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>DE89370400440532013000</IBAN></Id></DbtrAcct>
      <DbtrAgt><FinInstnId><BICFI>COBADEFFXXX</BICFI></FinInstnId></DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      <CdtTrfTxInf>
        <PmtId><EndToEndId>E2E-0001</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">1.00</InstdAmt></Amt>
        <CdtrAgt><FinInstnId/></CdtrAgt>
        <Cdtr><Nm>Test Creditor</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>DE65200400300234567000</IBAN></Id></CdtrAcct>
      </CdtTrfTxInf>
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`

    const result = parse(xml)
    // Must parse as pain.001, not fail with "unknown namespace"
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('expected ok:true but got: ' + result.error)
    }
    expect(result.type).toBe('pain.001')
  })

  it('a document with only a fake xmlns in a comment (no real Document xmlns) returns ok:false with missing namespace', () => {
    // The real Document tag has no xmlns. Only the comment has one.
    // Old code would have picked up the comment's xmlns and tried to parse as pain.001.
    // New code must return "missing xmlns" because Document has no xmlns.
    const xml = `<?xml version="1.0"?>
<!-- xmlns="${NS_PAIN001}" -->
<Document>
  <CstmrCdtTrfInitn/>
</Document>`

    const result = parse(xml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toMatch(/xmlns|namespace/i)
  })

  it('validateXsd: fake xmlns in comment does not steer schema selection', async () => {
    // The XML has a comment with a supported namespace, but the real Document
    // tag uses an unknown/unsupported namespace. validateXsd must report
    // unsupported namespace (or missing), never try to validate against a
    // schema selected from the comment.
    const xml = `<?xml version="1.0"?>
<!-- xmlns="${NS_PAIN001}" -->
<Document xmlns="${NS_UNKNOWN}">
  <SomeElement/>
</Document>`

    const result = await validateXsd(xml)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    // Must mention the actual (unknown) namespace, not the comment's namespace
    expect(result.errors[0]).toMatch(/unsupported|unknown|namespace/i)
  })

  it('a namespace inside a processing instruction before the root cannot steer detection', async () => {
    const declaration = '<?xml version="1.0" encoding="UTF-8"?>'
    const fake = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03'
    const xml = writeCreditTransfer(MINIMAL_CT).replace(
      declaration,
      `${declaration}<?pi <Document xmlns="${fake}"?>`
    )
    const result = parse(xml)
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (result.ok) expect(result.version).toBe('pain.001.001.09')
    expect(await validateXsd(xml)).toEqual({ valid: true, errors: [] })
  })

  it('reads the default namespace of the root element only', () => {
    const real = `<Document xmlns="${NS_PAIN001}"/>`
    const cases: Array<[string, string | null]> = [
      [real, NS_PAIN001],
      [`\uFEFF<?xml version="1.0"?>\n<!-- c --><?pi x?>\n\t${real}`, NS_PAIN001],
      [`<Document a="1" xmlns:x='u' xmlns='${NS_PAIN001}' b="<Document xmlns=">`, NS_PAIN001],
      [`<Document\n  xmlns = "${NS_PAIN001}">`, NS_PAIN001],
      [`<!-- <Document xmlns="${NS_UNKNOWN}"> --><?pi xmlns="${NS_UNKNOWN}"?>${real}`, NS_PAIN001],
      [
        `<Document xmlns="${NS_UNKNOWN}"><![CDATA[<Document xmlns="${NS_PAIN001}">]]></Document>`,
        NS_UNKNOWN,
      ],
      [`<Wrapper><Document xmlns="${NS_PAIN001}"/></Wrapper>`, null],
      [`<DocumentX xmlns="${NS_PAIN001}"/>`, null],
      ...['s', ':x', '-x', '.x', '0', '\u00B7', '\u{10000}'].map((continuation): [string, null] => [
        `<Document${continuation} xmlns="${NS_PAIN001}"/>`,
        null,
      ]),
      [`<Document xmlns=""/>`, null],
      [`<Document/>`, null],
      [`<!-- unterminated ${real}`, null],
      [`text${real}`, null],
    ]
    for (const [xml, expected] of cases) {
      expect(detectSepaNamespace(xml), xml).toBe(expected)
    }
  })

  it('pain.008 XML with a comment containing a different namespace still parses as pain.008', () => {
    const baseXml = writeDirectDebit(MINIMAL_DD)
    // Insert a comment with a pain.001 namespace after the XML declaration
    const xmlWithComment = baseXml.replace(
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- xmlns="${NS_PAIN001}" ignore this -->`
    )

    const result = parse(xmlWithComment)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true, got: ' + result.error)
    expect(result.type).toBe('pain.008')
  })
})

// ---------------------------------------------------------------------------
// Character and entity references: numeric references decode, undefined
// entities and bare ampersands are rejected without throwing
// ---------------------------------------------------------------------------

/** Replace the creditor name element of the minimal pain.001 document with raw XML text. */
function withCreditorNameXml(rawNameXml: string): string {
  return writeCreditTransfer(MINIMAL_CT).replace('<Nm>Test Creditor</Nm>', `<Nm>${rawNameXml}</Nm>`)
}

function parsedCreditorName(xml: string, options?: ParseOptions): string {
  const result = parse(xml, options)
  if (!result.ok) throw new Error('expected ok:true, got: ' + result.error)
  if (result.type !== 'pain.001') throw new Error('expected type pain.001')
  const name = result.data.batches[0]?.transfers[0]?.creditor.name
  if (name === undefined) throw new Error('creditor name missing')
  return name
}

function parseError(xml: string, options?: ParseOptions): string {
  const result = parse(xml, options)
  if (result.ok) throw new Error('expected ok:false')
  return result.error
}

/**
 * Every code point that JS matches with \s (and String.prototype.trim removes) but XML does
 * not treat as whitespace, derived from the regex engine itself.
 */
const JS_ONLY_WHITESPACE = Array.from({ length: 0x110000 }, (_, codePoint) => codePoint)
  .filter((codePoint) => codePoint < 0xd800 || codePoint > 0xdfff)
  .map((codePoint) => String.fromCodePoint(codePoint))
  .filter((character) => /\s/u.test(character) && !' \t\r\n'.includes(character))

function codePointLabel(character: string): string {
  return `U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`
}

describe('parse() character references', () => {
  it('should decode decimal and hexadecimal character references to the characters they name', () => {
    expect(parsedCreditorName(withCreditorNameXml('&#77;aja &#x53;tupica'))).toBe('Maja Stupica')
  })

  it('should accept hexadecimal digits in either case and leading zeros', () => {
    expect(parsedCreditorName(withCreditorNameXml('&#x4d;aja &#x0053;tupica'))).toBe('Maja Stupica')
  })

  it('should decode &#352;tupica and &#x160;tupica to the S-caron, not keep the reference text', () => {
    for (const reference of ['&#352;tupica', '&#x160;tupica']) {
      expect(parsedCreditorName(withCreditorNameXml(reference))).toBe('\u0160tupica')
      const error = parseError(withCreditorNameXml(reference), { charset: 'basic' })
      expect(error).toMatch(/^Model validation failed after parse: /)
      expect(error).toContain(
        'batches.0.transfers.0.creditor.name: Value contains characters outside the SEPA charset (EPC217-08): "\u0160" (U+0160).'
      )
    }
  })

  it('should decode in a single pass, so an escaped ampersand never forms a new reference', () => {
    expect(parsedCreditorName(withCreditorNameXml('&amp;#83;tupica'))).toBe('&#83;tupica')
    expect(parsedCreditorName(withCreditorNameXml('&#38;#83;tupica'))).toBe('&#83;tupica')
    expect(parsedCreditorName(withCreditorNameXml('&amp;amp;'))).toBe('&amp;')
    expect(parseError(withCreditorNameXml('&amp;#83;tupica'), { charset: 'basic' })).toMatch(
      /^Model validation failed after parse: /
    )
  })

  it('should decode references in attribute values', () => {
    const xml = writeCreditTransfer(MINIMAL_CT).replace('Ccy="EUR"', 'Ccy="&#69;&#x55;R"')
    expect(xml).toContain('Ccy="&#69;&#x55;R"')
    const result = parse(xml)
    expect(result.ok).toBe(true)
  })

  it('property: a basic-charset name written with arbitrary numeric references parses back to the same name', () => {
    const basic = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /-?:().,'+"
    const arbName = fc
      .array(fc.tuple(fc.constantFrom(...basic.split('')), fc.constantFrom('raw', 'dec', 'hex')), {
        minLength: 1,
        maxLength: 70,
      })
      .filter((units) => {
        const name = units.map(([ch]) => ch).join('')
        return name.trim() === name && name.length > 0
      })
    fc.assert(
      fc.property(arbName, (units) => {
        const name = units.map(([ch]) => ch).join('')
        const encoded = units
          .map(([ch, form]) => {
            const cp = ch.codePointAt(0) ?? 0
            if (form === 'dec') return `&#${cp};`
            if (form === 'hex') return `&#x${cp.toString(16)};`
            return ch === "'" ? '&apos;' : ch
          })
          .join('')
        return parsedCreditorName(withCreditorNameXml(encoded)) === name
      }),
      { numRuns: 200 }
    )
  })
})

describe('parse() rejects references that are not well-formed without a DTD', () => {
  it('should reject a bare ampersand with ok:false instead of keeping it as text', () => {
    expect(parseError(withCreditorNameXml('Tom & Jerry'))).toBe(
      'XML parse error: unescaped "&" (write it as &amp;)'
    )
  })

  it('should reject an ampersand after the root element as content outside it', () => {
    expect(parseError(writeCreditTransfer(MINIMAL_CT) + '&')).toBe(
      'XML parse error: content after the end of the root element'
    )
  })

  it('should reject an undefined entity such as &nbsp; with ok:false', () => {
    expect(parseError(withCreditorNameXml('Maja&nbsp;Stupica'))).toBe(
      'XML parse error: undefined entity reference "&nbsp;": without a DTD only &amp; &lt; &gt; &quot; &apos; and numeric character references are allowed'
    )
  })

  it('should reject HTML entities that the decoder would otherwise expand (&euro;, &copy;)', () => {
    expect(parseError(withCreditorNameXml('100 &euro;'))).toContain(
      'undefined entity reference "&euro;"'
    )
    expect(parseError(withCreditorNameXml('&copy; ACME'))).toContain(
      'undefined entity reference "&copy;"'
    )
  })

  it('should reject entity names in the wrong case (&AMP;)', () => {
    expect(parseError(withCreditorNameXml('A &AMP; B'))).toContain(
      'undefined entity reference "&AMP;"'
    )
  })

  it('should reject &#0; instead of silently removing it', () => {
    expect(parseError(withCreditorNameXml('Ma&#0;ja'))).toBe(
      'XML parse error: character reference "&#0;" is not a legal XML character'
    )
  })

  it('should reject references to code points outside the XML Char production', () => {
    for (const reference of [
      '&#x1;',
      '&#xD800;',
      '&#xDFFF;',
      '&#xFFFE;',
      '&#xFFFF;',
      '&#x110000;',
    ]) {
      expect(parseError(withCreditorNameXml(`A${reference}B`))).toBe(
        `XML parse error: character reference "${reference}" is not a legal XML character`
      )
    }
  })

  it('should reject malformed numeric references (uppercase X, stray letters, no digits)', () => {
    for (const reference of ['&#X53;', '&#12a;', '&#;', '&#x;']) {
      expect(parseError(withCreditorNameXml(`A${reference}B`))).toBe(
        `XML parse error: malformed character reference "${reference}" (expected &#NNN; or &#xHHHH;)`
      )
    }
  })

  it('should decode references with any number of leading zeros (only significant digits count)', () => {
    expect(parsedCreditorName(withCreditorNameXml('&#x000000053;tupica'))).toBe('Stupica')
    expect(parsedCreditorName(withCreditorNameXml('&#00000000083;tupica'))).toBe('Stupica')
    const zeros = '0'.repeat(40)
    expect(parsedCreditorName(withCreditorNameXml(`&#x${zeros}53;&#${zeros}83;`))).toBe('SS')
  })

  it('should reject a reference with more significant digits than the largest code point', () => {
    for (const reference of ['&#x1000000;', '&#x0001000000;', '&#11141120;', '&#0011141120;']) {
      expect(parseError(withCreditorNameXml(`A${reference}B`))).toBe(
        `XML parse error: character reference "${reference}" is not a legal XML character`
      )
    }
  })

  it('should decode references to code points above U+FFFF, up to U+10FFFF', () => {
    expect(decodeReferences('&#x10000;&#65536;&#x10FFFF;&#1114111;')).toBe(
      '\u{10000}\u{10000}\u{10FFFF}\u{10FFFF}'
    )
    const xml = writeCreditTransfer(MINIMAL_CT).replace(
      '</GrpHdr>',
      '<Unmodelled>&#x1F600;&#x10FFFF;</Unmodelled></GrpHdr>'
    )
    expect(parse(xml).ok).toBe(true)
    expect(parseError(withCreditorNameXml('Maja &#x1F600;'))).toContain(
      'creditor.name: Value contains characters outside the SEPA charset (EPC217-08): "\u{1F600}" (U+1F600).'
    )
  })

  it('should accept raw characters above U+FFFF as legal XML characters', () => {
    const xml = writeCreditTransfer(MINIMAL_CT).replace(
      '</GrpHdr>',
      '<Unmodelled>\u{10000}\u{1F600}\u{10FFFF}</Unmodelled></GrpHdr>'
    )
    expect(findWellFormednessProblem(xml)).toBeNull()
    expect(parse(xml).ok).toBe(true)
    expect(parseError(withCreditorNameXml('Maja \u{1F600}'))).toContain(
      'creditor.name: Value contains characters outside the SEPA charset (EPC217-08): "\u{1F600}" (U+1F600).'
    )
  })

  it('should reject a reference split by a comment', () => {
    expect(parseError(withCreditorNameXml('A &amp<!-- -->; B'))).toBe(
      'XML parse error: unescaped "&" (write it as &amp;)'
    )
  })

  it('should allow an ampersand inside a comment, a CDATA section and a processing instruction', () => {
    const xml = writeCreditTransfer(MINIMAL_CT)
      .replace('<CstmrCdtTrfInitn>', '<CstmrCdtTrfInitn><!-- R&D, &nbsp; -->')
      .replace(
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<?xml version="1.0" encoding="UTF-8"?><?app a&b?>'
      )
      .replace('</GrpHdr>', '<Unmodelled><![CDATA[Tom & Jerry &nbsp;]]></Unmodelled></GrpHdr>')
    const result = parse(xml)
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
  })

  it('should check references in attribute values', () => {
    const xml = writeCreditTransfer(MINIMAL_CT).replace('Ccy="EUR"', 'Ccy="&euro;"')
    expect(parseError(xml)).toContain('undefined entity reference "&euro;"')
  })

  it('should not let markup-like text inside an attribute value hide a reference from the guard', () => {
    const base = writeCreditTransfer(MINIMAL_CT)
    const sections: Array<[string, string]> = [
      ['<!--', '-->'],
      ['<![CDATA[', ']]>'],
      ['<?', '?>'],
    ]
    for (const [open, close] of sections) {
      const xml = base
        .replace('<Cdtr>', `<Cdtr x="${open}">`)
        .replace('<Nm>Test Creditor</Nm>', '<Nm>A&nbsp;B</Nm>')
        .replace('<CdtrAcct>', `<CdtrAcct z="${close}">`)
      expect(parseError(xml)).toBe(
        'XML parse error: unescaped "<" in an attribute value (write it as &lt;)'
      )
    }
  })

  it('should accept ">" and quotes of the other kind inside an attribute value', () => {
    const xml = writeCreditTransfer(MINIMAL_CT).replace('<Cdtr>', `<Cdtr x="a>b'c" y='d"e>f'>`)
    expect(parsedCreditorName(xml)).toBe('Test Creditor')
  })

  it('should report an unterminated comment, CDATA section, processing instruction or tag', () => {
    const base = writeCreditTransfer(MINIMAL_CT)
    expect(parseError(base.replace('</Document>', '<!-- open'))).toBe(
      'XML parse error: unterminated comment'
    )
    expect(parseError(base.replace('</Document>', '<![CDATA[ open'))).toBe(
      'XML parse error: unterminated CDATA section'
    )
    expect(parseError(base.replace('</Document>', '<?pi open'))).toBe(
      'XML parse error: unterminated processing instruction'
    )
    expect(parseError(base.replace('</Document>', '</Document'))).toBe(
      'XML parse error: unterminated tag'
    )
  })

  it('should keep text inside a CDATA section literal (no reference decoding)', () => {
    expect(parsedCreditorName(withCreditorNameXml('<![CDATA[&#83;tupica &amp; &nbsp;]]>'))).toBe(
      '&#83;tupica &amp; &nbsp;'
    )
  })

  it('should never throw for any reference-shaped input', () => {
    const arbReference = fc.oneof(
      fc.string({ unit: fc.constantFrom(...'&#x;0123456789abcdefABCDEFXamp'.split('')) }),
      fc.integer({ min: 0, max: 0x10ffff + 10 }).map((n) => `&#${n};`),
      fc.integer({ min: 0, max: 0x10ffff + 10 }).map((n) => `&#x${n.toString(16)};`)
    )
    fc.assert(
      fc.property(arbReference, (reference) => {
        expect(() => parse(withCreditorNameXml(reference))).not.toThrow()
      }),
      { numRuns: 300 }
    )
  })
})

// ---------------------------------------------------------------------------
// Structure: parse accepts only well-formed XML, read the way an XML parser reads it
// ---------------------------------------------------------------------------

const CREDITOR_BLOCK = /<Cdtr>[\s\S]*?<\/Cdtr>/

/** Replace the creditor block of the minimal pain.001 document with raw XML. */
function withCreditorXml(rawCreditorXml: string): string {
  const xml = writeCreditTransfer(MINIMAL_CT)
  if (!CREDITOR_BLOCK.test(xml)) throw new Error('the writer no longer emits a <Cdtr> block')
  return xml.replace(CREDITOR_BLOCK, rawCreditorXml)
}

const PI_QUOTE_PROBLEM =
  'XML parse error: processing instruction "<?pi" has a quote that is not closed before "?>"'

describe('parse() rejects documents fast-xml-parser would read differently from an XML parser', () => {
  it('should reject a processing instruction whose quote hides its end, in both charsets (review repro)', () => {
    for (const name of [
      'Maja &euro; Stupica',
      'Maja&nbsp;Stupica',
      'Maja & Stupica',
      'Maja&#0;Stupica',
    ]) {
      const xml = withCreditorXml(`<Cdtr><?pi x="?><!--"?><Nm>${name}</Nm><!-- --></Cdtr>`)
      expect(parseError(xml)).toBe(PI_QUOTE_PROBLEM)
      expect(parseError(xml, { charset: 'basic' })).toBe(PI_QUOTE_PROBLEM)
    }
  })

  it('should reject "<![" that does not start a CDATA section, in both charsets (review repro)', () => {
    for (const name of ['Maja &euro; Stupica', 'Maja&#0;Stupica']) {
      const xml = withCreditorXml(`<Cdtr><![X[ > <!-- ]]><Nm>${name}</Nm><!-- --></Cdtr>`)
      const problem = 'XML parse error: "<![" must start a CDATA section (<![CDATA[)'
      expect(parseError(xml)).toBe(problem)
      expect(parseError(xml, { charset: 'basic' })).toBe(problem)
    }
  })

  it('should not read a creditor name that an XML parser sees inside a comment (XSD-valid file)', async () => {
    const xml = withCreditorXml('<Cdtr><?pi x="?><!--"?><Nm>Hidden Name</Nm>--></Cdtr>')
    expect(await validateXsd(xml)).toEqual({ valid: true, errors: [] })
    expect(libxml2Read(xml)).toEqual({ wellFormed: true, creditorName: null })
    expect(parseError(xml)).toBe(PI_QUOTE_PROBLEM)
  })

  it('should not decode or check references inside a processing instruction', () => {
    const declaration = '<?xml version="1.0" encoding="UTF-8"?>'
    const xml = writeCreditTransfer(MINIMAL_CT)
      .replace(declaration, `${declaration}<?app note="R&D &nbsp;"?>`)
      .replace('<Cdtr>', '<Cdtr><?app a="&" b="&#0;"?>')
    expect(libxml2Read(xml)).toEqual({ wellFormed: true, creditorName: 'Test Creditor' })
    expect(parsedCreditorName(xml)).toBe('Test Creditor')
  })

  it('should keep processing instructions whose quotes are balanced, and the XML declaration', () => {
    const declaration = '<?xml version="1.0" encoding="UTF-8"?>'
    const xml = writeCreditTransfer(MINIMAL_CT)
      .replace(declaration, `${declaration}<?xml-stylesheet type="text/xsl" href="a?b.xsl"?>`)
      .replace('<Cdtr>', `<Cdtr><?app note='it"s'?>`)
    expect(xml.startsWith(declaration)).toBe(true)
    expect(parsedCreditorName(xml)).toBe('Test Creditor')
    for (const variant of [
      "<?xml version='1.0'?>",
      '<?xml version="1.0" encoding="utf-8" standalone="yes"?>',
      '﻿<?xml version="1.0" encoding="UTF-8"?>',
    ]) {
      expect(
        parsedCreditorName(writeCreditTransfer(MINIMAL_CT).replace(declaration, variant))
      ).toBe('Test Creditor')
    }
  })

  it('should reject constructs that are not well-formed XML, with a message naming the problem', () => {
    const base = writeCreditTransfer(MINIMAL_CT)
    const cases: Array<[string, string]> = [
      [withCreditorNameXml('A</x>B'), 'end tag </x> does not match <Nm>'],
      [withCreditorXml('<Cdtr><Nm>A</Nm><x></Cdtr>'), 'end tag </Cdtr> does not match <x>'],
      [withCreditorNameXml('A]]>B'), '"]]>" is not allowed in text (write > as &gt;)'],
      [withCreditorNameXml('A<!-- a -- b -->B'), '"--" is not allowed inside a comment'],
      [withCreditorNameXml('A<![cdata[x]]>B'), '"<![" must start a CDATA section (<![CDATA[)'],
      [withCreditorNameXml('A<!ELEMENT x>B'), 'unexpected "<!" (comments start with <!--)'],
      [withCreditorNameXml('A<?>B'), 'processing instruction without a target name'],
      [
        withCreditorNameXml('A<?x"?>B'),
        'processing instruction target "x" must be followed by whitespace',
      ],
      [
        withCreditorNameXml('A<?xml version="1.0"?>B'),
        'reserved processing instruction target "xml" (an XML declaration must come first)',
      ],
      [withCreditorNameXml('A<?p:x?>B'), 'processing instruction target "p:x" has a colon'],
      [withCreditorNameXml('A < B'), 'unescaped "<" (write it as &lt;)'],
      [withCreditorNameXml('A\u0001B'), 'the character U+0001 is not allowed in XML'],
      [withCreditorNameXml('A￾B'), 'the character U+FFFE is not allowed in XML'],
      [base.replace('<Cdtr>', '<Cdtr x="1" x="2">'), 'attribute x is repeated on <Cdtr>'],
      [base.replace('<Cdtr>', '<Cdtr x="1"y="2">'), 'malformed start tag <Cdtr>'],
      [base.replace('<Cdtr>', '<Cdtr x=1>'), 'attribute x of <Cdtr> needs a quoted value'],
      [base.replace('<Cdtr>', '<Cdtr x>'), 'attribute x of <Cdtr> has no value'],
      [base.replace('</Cdtr>', '</Cdtr x>'), 'malformed end tag </Cdtr>'],
      [base.replace('<Cdtr>', '<Cdtr xsi:type="x">'), 'namespace prefix xsi is not declared'],
      [
        base.replace('<Cdtr>', '<Cdtr><x xmlns:p="urn:p"></x><p:y/>'),
        'namespace prefix p is not declared',
      ],
      [
        base.replace('<Cdtr>', '<Cdtr><x xmlns:p="urn:p"><p:y/></x><z p:a="1"/>'),
        'namespace prefix p is not declared',
      ],
      [
        base.replace('<Cdtr>', '<Cdtr xmlns:p="">'),
        'namespace prefix p cannot be bound to an empty namespace',
      ],
      [base.replace('<Cdtr>', '<Cdtr xmlns:xmlns="urn:x">'), 'the xmlns prefix cannot be declared'],
      [
        base.replace('<Cdtr>', '<Cdtr xmlns:xml="urn:x">'),
        'only the xml prefix is bound to http://www.w3.org/XML/1998/namespace',
      ],
      [
        base.replace('<Cdtr>', '<Cdtr xmlns:p="http://www.w3.org/XML/1998/namespace">'),
        'only the xml prefix is bound to http://www.w3.org/XML/1998/namespace',
      ],
      [
        base.replace('<Cdtr>', '<Cdtr xmlns:p="http://www.w3.org/XML/1998/&#110;amespace">'),
        'only the xml prefix is bound to http://www.w3.org/XML/1998/namespace',
      ],
      [
        base.replace('<Cdtr>', '<Cdtr xmlns="http://www.w3.org/XML/1998/namespace">'),
        'only the xml prefix is bound to http://www.w3.org/XML/1998/namespace',
      ],
      [
        base.replace('<Cdtr>', '<Cdtr xmlns="http://www.w3.org/XML/1998/&#x6E;amespace">'),
        'only the xml prefix is bound to http://www.w3.org/XML/1998/namespace',
      ],
      [
        base.replace('<Cdtr>', '<Cdtr xmlns:p="http://www.w3.org/2000/xmlns/">'),
        'the namespace http://www.w3.org/2000/xmlns/ cannot be declared',
      ],
      [
        base.replace('<Cdtr>', '<Cdtr xmlns:p="http://www.w3.org/2000/&#120;mlns/">'),
        'the namespace http://www.w3.org/2000/xmlns/ cannot be declared',
      ],
      [
        base.replace('<Cdtr>', '<Cdtr xmlns="http://www.w3.org/2000/xmlns/">'),
        'the namespace http://www.w3.org/2000/xmlns/ cannot be declared',
      ],
      [
        base.replace('<Cdtr>', '<Cdtr xmlns:xml="http://www.w3.org/2000/xmlns/">'),
        'the namespace http://www.w3.org/2000/xmlns/ cannot be declared',
      ],
      [
        base.replace('<Cdtr>', '<Cdtr xmlns:a="urn:x" xmlns:b="urn:x" a:k="1" b:k="2">'),
        'attribute {urn:x}k is repeated on <Cdtr>',
      ],
      [base.replace('<Cdtr>', '<Cdtr xmlns:="urn:x">'), 'malformed namespace declaration xmlns:'],
      [base.replace('<Cdtr>', '<p:a:Cdtr>'), '"p:a:Cdtr" is not a valid qualified name'],
      [base + '<Extra/>', 'content after the end of the root element'],
      [
        base.replace('<?xml version="1.0" encoding="UTF-8"?>', '<?xml version="2.0"?>'),
        'malformed XML declaration',
      ],
      [
        base.replace('<?xml version="1.0" encoding="UTF-8"?>', ' <?xml version="1.0"?>'),
        'reserved processing instruction target "xml" (an XML declaration must come first)',
      ],
      [`text${base}`, 'text before the root element'],
      ['<!-- only a comment -->', 'the document has no root element'],
      [base.replace('</Document>', '<Unclosed>'), 'unterminated element <Unclosed>'],
    ]
    for (const [xml, problem] of cases) {
      expect(parseError(xml), problem).toBe(`XML parse error: ${problem}`)
      expect(libxml2Read(xml).wellFormed, problem).toBe(false)
    }
  })

  it('should reject every JS-only space in an element name, which fast-xml-parser would split (review repro)', () => {
    const base = writeCreditTransfer(MINIMAL_CT)
    const xmlNameCharacters = ['\u1680', '\uFEFF']
    for (const character of JS_ONLY_WHITESPACE) {
      const label = codePointLabel(character)
      const xml = base.replace(
        '<Nm>Test Creditor</Nm>',
        `<Nm${character}>Hidden</Nm${character}><Nm>Test Creditor</Nm>`
      )
      expect(parse(xml).ok, label).toBe(false)
      expect(libxml2Read(xml).wellFormed, label).toBe(xmlNameCharacters.includes(character))
    }
    for (const character of xmlNameCharacters) {
      const xml = base.replace('<Nm>Test Creditor</Nm>', `<Nm${character}>Hidden</Nm${character}>`)
      expect(libxml2Read(xml)).toEqual({ wellFormed: true, creditorName: null })
      expect(parseError(xml)).toBe(
        `XML parse error: the name "Nm${character}" contains ${codePointLabel(character)}, a Unicode space that parse does not accept in element and attribute names`
      )
      const leading = base.replace('</Cdtr>', `<${character}x/></Cdtr>`)
      expect(libxml2Read(leading).wellFormed).toBe(true)
      expect(parseError(leading)).toContain(`the name "${character}x" contains`)
    }
  })

  it('should reject every JS-only space in an attribute name, which fast-xml-parser would split (review repro)', () => {
    const base = writeCreditTransfer(MINIMAL_CT)
    for (const character of JS_ONLY_WHITESPACE) {
      const label = codePointLabel(character)
      const xml = base.replace(
        '<InstdAmt Ccy="EUR">',
        `<InstdAmt Ccy="USD" X${character}Ccy="EUR">`
      )
      expect(parse(xml).ok, label).toBe(false)
    }
    for (const character of ['\u1680', '\uFEFF']) {
      const xml = base.replace(
        '<InstdAmt Ccy="EUR">',
        `<InstdAmt Ccy="USD" X${character}Ccy="EUR">`
      )
      expect(libxml2Read(xml).wellFormed).toBe(true)
      expect(parseError(xml)).toContain(`the name "X${character}Ccy" contains`)
    }
  })

  it('should accept the declarations the reserved-name rules allow: xml to its namespace, an empty default', () => {
    const xml = writeCreditTransfer(MINIMAL_CT)
      .replace('<Cdtr>', '<Cdtr xmlns:xml="http://www.w3.org/XML/1998/namespace">')
      .replace('</GrpHdr>', '<Unmodelled xmlns=""><x xmlns="urn:x"/></Unmodelled></GrpHdr>')
    expect(libxml2Read(xml)).toEqual({ wellFormed: true, creditorName: 'Test Creditor' })
    expect(parsedCreditorName(xml)).toBe('Test Creditor')
  })

  it('should accept well-formed namespace use and XML whitespace inside tags', () => {
    const xml = writeCreditTransfer(MINIMAL_CT)
      .replace(
        /<Document xmlns="([^"]+)">/,
        '<Document xmlns="$1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="$1 pain.001.001.09.xsd">'
      )
      .replace('<Cdtr>', '<Cdtr\n  xml:lang = "sl" >')
      .replace('</Cdtr>', '</Cdtr\t>')
    expect(libxml2Read(xml)).toEqual({ wellFormed: true, creditorName: 'Test Creditor' })
    expect(parsedCreditorName(xml)).toBe('Test Creditor')
  })
})

describe('decodeReferences: the entity decoder fast-xml-parser uses', () => {
  it('should decode only the predefined entities and numeric references, in one pass', () => {
    expect(decodeReferences('&lt;&gt;&amp;&quot;&apos;&#83;&#x160;')).toBe('<>&"\'SŠ')
    expect(decodeReferences('&amp;nbsp; &#38;euro;')).toBe('&nbsp; &euro;')
    expect(decodeReferences('no references')).toBe('no references')
  })

  it('should throw on HTML entities, a bare ampersand and illegal code points', () => {
    expect(() => decodeReferences('&nbsp;')).toThrow('undefined entity reference "&nbsp;"')
    expect(() => decodeReferences('&euro;')).toThrow('undefined entity reference "&euro;"')
    expect(() => decodeReferences('R&D')).toThrow('unescaped "&" (write it as &amp;)')
    expect(() => decodeReferences('&#0;')).toThrow('"&#0;" is not a legal XML character')
  })

  it('should shorten a very long reference in its message', () => {
    expect(() => decodeReferences(`&${'a'.repeat(1000)};`)).toThrow(
      `undefined entity reference "&${'a'.repeat(40)}...;"`
    )
  })
})

// ---------------------------------------------------------------------------
// Declared encodings: a JS string is already decoded, so both readers ignore the label
// ---------------------------------------------------------------------------

describe('parse() and validateXsd() read the string as given, whatever encoding is declared', () => {
  const DECLARED_ENCODINGS = ['UTF-8', 'ISO-8859-1', 'UTF-16', 'UCS-4', 'X-UNKNOWN']

  function declaring(encoding: string, xml: string): string {
    return xml.replace('encoding="UTF-8"', `encoding="${encoding}"`)
  }

  it('should validate an XSD-valid file with "Müller Štupica" in every declared encoding (review repro)', async () => {
    const xml = writeCreditTransfer(MINIMAL_CT).replace(
      '<Nm>Test Initiator</Nm>',
      '<Nm>Müller Štupica</Nm>'
    )
    for (const encoding of DECLARED_ENCODINGS) {
      const declared = declaring(encoding, xml)
      expect(declared, encoding).toContain(`encoding="${encoding}"`)
      expect(await validateXsd(declared), encoding).toEqual({ valid: true, errors: [] })
      const result = parse(declared)
      expect(result.ok && result.data.initiatingParty, encoding).toBe('Müller Štupica')
    }
  })

  it('should report the value the string holds, not a re-decoded one, in an XSD error', async () => {
    const xml = writeCreditTransfer(MINIMAL_CT).replace(
      '<IBAN>DE65200400300234567000</IBAN>',
      '<IBAN>DE65Müller</IBAN>'
    )
    for (const encoding of DECLARED_ENCODINGS) {
      const result = await validateXsd(declaring(encoding, xml))
      expect(result.valid, encoding).toBe(false)
      expect(result.errors.join(' '), encoding).toContain("The value 'DE65Müller' is not accepted")
    }
  })
})

// ---------------------------------------------------------------------------
// Element text: read as XML reads it, trimmed of XML whitespace only
// ---------------------------------------------------------------------------

const MINIMAL_CT_WITH_REMITTANCE: CreditTransferDocument = {
  ...MINIMAL_CT,
  batches: MINIMAL_CT.batches.map((batch) => ({
    ...batch,
    transfers: batch.transfers.map((transfer) => ({ ...transfer, remittanceInfo: 'Invoice 1' })),
  })),
}
const USTRD = '<Ustrd>Invoice 1</Ustrd>'

/** The minimal pain.001 with remittance information, its <Ustrd> element replaced by raw XML. */
function withRemittanceXml(rawRemittanceXml: string): string {
  return writeCreditTransfer(MINIMAL_CT_WITH_REMITTANCE).replace(USTRD, rawRemittanceXml)
}

function parsedTransfer(
  xml: string
): CreditTransferDocument['batches'][number]['transfers'][number] {
  const result = parse(xml)
  if (!result.ok) throw new Error('expected ok:true, got: ' + result.error)
  if (result.type !== 'pain.001') throw new Error('expected type pain.001')
  const transfer = result.data.batches[0]?.transfers[0]
  if (transfer === undefined) throw new Error('transfer missing')
  return transfer
}

describe('parse() reads element text the way an XML parser reads it', () => {
  it('should keep the space next to a CDATA section (review repro)', async () => {
    const names: Array<[string, string]> = [
      ['Maja <![CDATA[Stupica]]>', 'Maja Stupica'],
      ['<![CDATA[Maja]]> Stupica', 'Maja Stupica'],
      ['A <![CDATA[B]]> C', 'A B C'],
      ['<![CDATA[ Maja ]]>', 'Maja'],
    ]
    for (const [raw, name] of names) {
      const xml = withCreditorNameXml(raw)
      expect(parsedCreditorName(xml), raw).toBe(name)
      expect(libxml2Read(xml), raw).toEqual({
        wellFormed: true,
        creditorName: raw.startsWith('<![CDATA[ ') ? ' Maja ' : name,
      })
    }
    expect(await validateXsd(withCreditorNameXml(names[0]?.[0] ?? ''))).toEqual({
      valid: true,
      errors: [],
    })
  })

  it('should read the text around a processing instruction or a comment inside Ustrd (review repro)', async () => {
    const remittances: Array<[string, string]> = [
      ['<Ustrd>Invoice <?app note?>1</Ustrd>', 'Invoice 1'],
      ['<Ustrd>Invoice 1<?xml-stylesheet href="a"?></Ustrd>', 'Invoice 1'],
      ['<Ustrd><?app?>Invoice<!-- c --> 1</Ustrd>', 'Invoice 1'],
    ]
    for (const [raw, remittanceInfo] of remittances) {
      expect(parsedTransfer(withRemittanceXml(raw)).remittanceInfo, raw).toBe(remittanceInfo)
    }
    expect(await validateXsd(withRemittanceXml(remittances[0]?.[0] ?? ''))).toEqual({
      valid: true,
      errors: [],
    })
  })

  it('should trim only space, tab, CR and LF at the edges of a text value', () => {
    expect(parsedCreditorName(withCreditorNameXml('\n\t Test  Creditor \r\n\t'))).toBe(
      'Test  Creditor'
    )
    expect(parsedCreditorName(withCreditorNameXml('&#32;&#9;Test Creditor&#10;&#13;'))).toBe(
      'Test Creditor'
    )
  })

  it('should keep every other JS whitespace character at the edges, so the charset rejects it (review repro)', () => {
    expect(JS_ONLY_WHITESPACE.map((character) => character.codePointAt(0))).toEqual([
      0x0b, 0x0c, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
      0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
    ])
    expect(JS_ONLY_WHITESPACE.every((character) => character.trim() === '')).toBe(true)
    const base = writeCreditTransfer(MINIMAL_CT)
    for (const character of JS_ONLY_WHITESPACE.filter((c) => c !== '\v' && c !== '\f')) {
      const label = codePointLabel(character)
      for (const xml of [
        base.replace(
          '<EndToEndId>E2E-0001</EndToEndId>',
          `<EndToEndId>E2E-0001${character}</EndToEndId>`
        ),
        withCreditorNameXml(`${character}Test Creditor`),
        withCreditorNameXml(`Test Creditor${character}`),
        base.replace(
          '<InstdAmt Ccy="EUR">1.00</InstdAmt>',
          `<InstdAmt Ccy="EUR">${character}1.00</InstdAmt>`
        ),
        base.replace('Ccy="EUR"', `Ccy="EUR${character}"`),
      ]) {
        expect(parse(xml).ok, label).toBe(false)
      }
    }
  })

  it('should keep reading ASCII whitespace around an amount and its currency as before', () => {
    const xml = writeCreditTransfer(MINIMAL_CT).replace(
      '<InstdAmt Ccy="EUR">1.00</InstdAmt>',
      '<InstdAmt Ccy=" EUR\t">\n  1.00\n</InstdAmt>'
    )
    expect(parsedTransfer(xml).amount).toEqual(euros('1.00'))
  })

  it('should return ok:false for two Ustrd elements instead of dropping both (review repro)', async () => {
    const xml = withRemittanceXml(`${USTRD}<Ustrd>Invoice 2</Ustrd>`)
    expect(await validateXsd(xml)).toEqual({ valid: true, errors: [] })
    expect(parseError(xml)).toBe(
      'Cannot read <Ustrd>: it occurs 2 times, but the model holds a single value'
    )
    const dd = writeDirectDebit({
      ...MINIMAL_DD,
      batches: MINIMAL_DD.batches.map((batch) => ({
        ...batch,
        collections: batch.collections.map((c) => ({ ...c, remittanceInfo: 'Invoice 1' })),
      })),
    }).replace(USTRD, `${USTRD}<Ustrd>Invoice 2</Ustrd>${USTRD}`)
    expect(parseError(dd)).toBe(
      'Cannot read <Ustrd>: it occurs 3 times, but the model holds a single value'
    )
  })

  it('should return ok:false for any repeated element the model holds once', () => {
    const base = writeCreditTransfer(MINIMAL_CT)
    const cases: Array<[string, string]> = [
      [
        withRemittanceXml(
          '<Strd><CdtrRefInf><Ref>A</Ref></CdtrRefInf></Strd><Strd><CdtrRefInf><Ref>B</Ref></CdtrRefInf></Strd>'
        ),
        'Strd',
      ],
      [base.replace('<Nm>Test Creditor</Nm>', '<Nm>Test Creditor</Nm><Nm>Other</Nm>'), 'Nm'],
      [
        writeCreditTransfer({
          ...MINIMAL_CT,
          batches: MINIMAL_CT.batches.map((batch) => ({
            ...batch,
            transfers: batch.transfers.map((transfer) => ({
              ...transfer,
              ultimateDebtor: { name: 'Ultimate', id: { organisationId: { other: { id: 'A' } } } },
            })),
          })),
        }).replace('</Othr>', '</Othr><Othr><Id>B</Id></Othr>'),
        'Othr',
      ],
      [
        base.replace('</CdtTrfTxInf>', '<RmtInf><Ustrd>A</Ustrd></RmtInf><RmtInf/></CdtTrfTxInf>'),
        'RmtInf',
      ],
    ]
    for (const [xml, element] of cases) {
      expect(parseError(xml), element).toBe(
        `Cannot read <${element}>: it occurs 2 times, but the model holds a single value`
      )
    }
  })

  it('should return ok:false for a text element that holds an element, instead of reading it as absent', () => {
    expect(parseError(withCreditorNameXml('Test<x/>Creditor'))).toBe(
      'Cannot read <Nm>: it contains the element <x>, but the model holds text'
    )
    expect(parseError(withRemittanceXml('<Ustrd>Invoice<x/> 1</Ustrd>'))).toBe(
      'Cannot read <Ustrd>: it contains the element <x>, but the model holds text'
    )
  })

  it('should read a text element whose namespace declarations keep its namespace', async () => {
    const prefixed = withRemittanceXml('<Ustrd xmlns:x="urn:x">Invoice 1</Ustrd>')
    expect(await validateXsd(prefixed)).toEqual({ valid: true, errors: [] })
    expect(parsedTransfer(prefixed).remittanceInfo).toBe('Invoice 1')
    const repeated = writeCreditTransfer(MINIMAL_CT).replace(
      '<BICFI>COBADEFFXXX</BICFI>',
      `<BICFI xmlns="${NS_PAIN001}">COBADEFFXXX</BICFI>`
    )
    expect(await validateXsd(repeated)).toEqual({ valid: true, errors: [] })
    const result = parse(repeated)
    expect(result.ok && result.data.batches[0]?.debtor.bic).toBe('COBADEFFXXX')
  })

  it('should return ok:false for a text element with an attribute the model does not hold', () => {
    expect(parseError(withRemittanceXml('<Ustrd xmlns="urn:other">Invoice 1</Ustrd>'))).toBe(
      'Cannot read <Ustrd>: it carries the attribute xmlns, which the model does not hold'
    )
    expect(
      parseError(
        withCreditorNameXml('Test Creditor').replace(
          '<Nm>Test Creditor',
          '<Nm xml:lang="de">Test Creditor'
        )
      )
    ).toBe('Cannot read <Nm>: it carries the attribute xml:lang, which the model does not hold')
  })

  it('should not let indentation between elements reach the model', () => {
    const minified = writeCreditTransfer(MINIMAL_CT_WITH_REMITTANCE).replace(/>\s+</g, '><')
    const indented = minified.replace(/></g, '>\r\n\t  \n<')
    expect(parsedTransfer(indented)).toEqual(parsedTransfer(minified))
    const result = parse(indented)
    expect(result.ok && result.data).toEqual(MINIMAL_CT_WITH_REMITTANCE)
  })
})

// ---------------------------------------------------------------------------
// Differential fuzz: parse against libxml2
// ---------------------------------------------------------------------------

type Libxml2Result<T> = { wellFormed: true } & T

/** Parse with libxml2 (as validateXsd does) and read the document, or report it as not well-formed. */
function readWithLibxml2<T>(
  xml: string,
  read: (doc: XmlDocument) => T
): Libxml2Result<T> | { wellFormed: false } {
  let doc: XmlDocument
  try {
    doc = XmlDocument.fromString(xml, { option: ParseOption.XML_PARSE_NO_XXE })
  } catch (e) {
    if (e instanceof XmlParseError) return { wellFormed: false }
    throw e
  }
  try {
    return { wellFormed: true, ...read(doc) }
  } finally {
    doc[Symbol.dispose]()
  }
}

/** What libxml2 reads: whether the document is well-formed, and the first creditor name. */
function libxml2Read(
  xml: string
): Libxml2Result<{ creditorName: string | null }> | { wellFormed: false } {
  return readWithLibxml2(xml, (doc) => {
    const name = doc.get("(//*[local-name()='Cdtr'])[1]/*[local-name()='Nm']")
    return { creditorName: name === null ? null : name.content }
  })
}

const XML_WHITESPACE_AT_EDGES = /^[ \t\r\n]+|[ \t\r\n]+$/g

/** A decimal amount as the model holds it (minor units), or the text itself when it is not one. */
function minorUnitsOf(text: string): string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text)
  if (match === null) return text
  return String(BigInt(match[1] ?? '0') * 100n + BigInt((match[2] ?? '0').padEnd(2, '0')))
}

type FuzzTransfer = CreditTransferDocument['batches'][number]['transfers'][number]
const transferOf = (doc: CreditTransferDocument): FuzzTransfer | undefined =>
  doc.batches[0]?.transfers[0]

/**
 * Every modelled text field of the fuzz template: the path libxml2 reads it at (below
 * CstmrCdtTrfInitn, by local name), the value the model holds, and how a libxml2 text
 * compares to it (after XML whitespace is trimmed at the edges).
 */
const FUZZ_FIELDS: ReadonlyArray<{
  path: string
  model: (doc: CreditTransferDocument) => string | undefined
  fromXml?: (text: string) => string
}> = [
  { path: 'GrpHdr/MsgId', model: (doc) => doc.messageId },
  { path: 'GrpHdr/CreDtTm', model: (doc) => doc.createdAt },
  { path: 'GrpHdr/InitgPty/Nm', model: (doc) => doc.initiatingParty },
  { path: 'PmtInf/PmtInfId', model: (doc) => doc.batches[0]?.id },
  { path: 'PmtInf/ReqdExctnDt/Dt', model: (doc) => doc.batches[0]?.executionDate },
  { path: 'PmtInf/Dbtr/Nm', model: (doc) => doc.batches[0]?.debtor.name },
  { path: 'PmtInf/DbtrAcct/Id/IBAN', model: (doc) => doc.batches[0]?.debtor.iban },
  { path: 'PmtInf/DbtrAgt/FinInstnId/BICFI', model: (doc) => doc.batches[0]?.debtor.bic },
  { path: 'PmtInf/CdtTrfTxInf/PmtId/EndToEndId', model: (doc) => transferOf(doc)?.endToEndId },
  {
    path: 'PmtInf/CdtTrfTxInf/Amt/InstdAmt',
    model: (doc) => transferOf(doc)?.amount.minorUnits.toString(),
    fromXml: minorUnitsOf,
  },
  {
    path: 'PmtInf/CdtTrfTxInf/Amt/InstdAmt/@Ccy',
    model: (doc) => transferOf(doc)?.amount.currencyCode,
  },
  {
    path: 'PmtInf/CdtTrfTxInf/CdtrAgt/FinInstnId/BICFI',
    model: (doc) => transferOf(doc)?.creditor.bic,
  },
  { path: 'PmtInf/CdtTrfTxInf/Cdtr/Nm', model: (doc) => transferOf(doc)?.creditor.name },
  { path: 'PmtInf/CdtTrfTxInf/CdtrAcct/Id/IBAN', model: (doc) => transferOf(doc)?.creditor.iban },
  { path: 'PmtInf/CdtTrfTxInf/RmtInf/Ustrd', model: (doc) => transferOf(doc)?.remittanceInfo },
]

function xpathOf(path: string): string {
  const steps = ['Document', 'CstmrCdtTrfInitn', ...path.split('/')]
  return steps
    .map((step) => (step.startsWith('@') ? step : `*[local-name()='${step}']`))
    .join('/')
    .replace(/^/, '/')
}

/** Every FUZZ_FIELDS text as libxml2 reads it: one entry per element (or attribute) found. */
function libxml2Fields(
  xml: string
): Libxml2Result<{ fields: Record<string, string[]> }> | { wellFormed: false } {
  return readWithLibxml2(xml, (doc) => ({
    fields: Object.fromEntries(
      FUZZ_FIELDS.map(({ path }) => [path, doc.find(xpathOf(path)).map((node) => node.content)])
    ),
  }))
}

/**
 * parse returns ok:false with "Cannot read <X>: ..." only when libxml2 agrees that X is not
 * one text value: it occurs twice under one parent, or it holds the named child element.
 */
function expectUnreadableClaimHolds(xml: string, error: string): void {
  const repeated = /^Cannot read <([^>]+)>: it occurs \d+ times/.exec(error)
  const nested = /^Cannot read <([^>]+)>: it contains the element <([^>]+)>/.exec(error)
  const xpath =
    repeated !== null
      ? `//*[count(*[local-name()='${repeated[1]}']) > 1]`
      : nested !== null
        ? `//*[local-name()='${nested[1]}']/*[local-name()='${nested[2]}']`
        : null
  if (xpath === null) return
  const found = readWithLibxml2(xml, (doc) => ({ count: doc.find(xpath).length }))
  expect(found.wellFormed && found.count > 0, `libxml2 does not see why: ${error}`).toBe(true)
}

/** The scan rules that are parse's own, not XML's: libxml2 reads these documents as well-formed. */
const PARSE_ONLY_PROBLEMS = [
  'has a quote that is not closed',
  'a Unicode space that parse does not accept',
]

function expectParseAgreesWithLibxml2(xml: string): void {
  const libxml2 = libxml2Fields(xml)
  const problem = findWellFormednessProblem(xml)
  if (problem === null || !PARSE_ONLY_PROBLEMS.some((own) => problem.includes(own))) {
    expect(problem === null, `scan: ${problem}`).toBe(libxml2.wellFormed)
  }
  const result = parse(xml)
  if (!result.ok) {
    expectUnreadableClaimHolds(xml, result.error)
    return
  }
  expect(libxml2.wellFormed).toBe(true)
  if (!libxml2.wellFormed || result.type !== 'pain.001') throw new Error('expected a pain.001')
  expectFieldsAgree(libxml2.fields, result.data)
}

/** Each FUZZ_FIELDS value of the model equals libxml2's text, trimmed of XML whitespace. */
function expectFieldsAgree(fields: Record<string, string[]>, doc: CreditTransferDocument): void {
  for (const { path, model, fromXml } of FUZZ_FIELDS) {
    const texts = fields[path] ?? []
    expect(texts.length, `${path}: libxml2 reads ${texts.length} values`).toBeLessThanOrEqual(1)
    const trimmed = texts[0]?.replace(XML_WHITESPACE_AT_EDGES, '')
    const text = trimmed === undefined || fromXml === undefined ? trimmed : fromXml(trimmed)
    const value = model(doc)
    if (value === undefined) {
      expect(text ?? '', `${path}: present in libxml2's reading but absent in the model`).toBe('')
    } else {
      expect(value, `${path}: the model holds a value libxml2 does not read`).toBe(text)
    }
  }
}

/** The fuzz template: the minimal pain.001 with remittance information. */
const FUZZ_TEMPLATE = writeCreditTransfer(MINIMAL_CT_WITH_REMITTANCE)

const XML_WHITESPACE_PIECES = [' ', '\t', '\n', '\r', '\r\n']
const FUZZ_CHARACTERS = [
  ...'<?![]>"\'-&#;x0123456789/=:A',
  ...XML_WHITESPACE_PIECES,
  ...JS_ONLY_WHITESPACE,
]
const FUZZ_TOKENS = [
  '<Nm>',
  '</Nm>',
  '<x>',
  '</x>',
  '<x/>',
  '<x x="1">',
  `<x x='"'/>`,
  '<x x="&amp;"/>',
  '<x x="<"/>',
  '<!--',
  '-->',
  '<!---->',
  '<?x',
  '<?x ',
  '?>',
  '<?x?>',
  '<?x "?>',
  `<?x '"'?>`,
  '<![CDATA[',
  '<![x[',
  ']]>',
  '&amp;',
  '&lt;',
  '&#x41;',
  '&#65;',
  '&#32;',
  '&#0;',
  '&#x0000000041;',
  '&#x1F600;',
  '&nbsp;',
  '&euro;',
  '<p:x/>',
  '<x xmlns:p="urn:p"><p:x/></x>',
]

/** Pieces of text content: whitespace of both kinds, CDATA next to text, PIs, comments, a second element. */
const FUZZ_TEXT_PIECES = [
  'A',
  '1',
  '-',
  '/',
  ...XML_WHITESPACE_PIECES,
  ...JS_ONLY_WHITESPACE,
  '<![CDATA[A]]>',
  '<![CDATA[ ]]>',
  '<![CDATA[]]>',
  ' <![CDATA[B]]> ',
  '<?app note?>',
  '<?app?>',
  '<!-- c -->',
  '&#32;',
  '&#9;',
  '&#10;',
  '&#xA0;',
  '&#xFEFF;',
  '&#65;',
  '</Ustrd><Ustrd>',
  '</Nm><Nm>',
]
const arbFuzzPiece = fc.oneof(fc.constantFrom(...FUZZ_CHARACTERS), fc.constantFrom(...FUZZ_TOKENS))
const arbFuzzPart = fc.array(arbFuzzPiece, { maxLength: 8 }).map((pieces) => pieces.join(''))
const arbTextPart = fc
  .array(fc.constantFrom(...FUZZ_TEXT_PIECES), { maxLength: 3 })
  .map((pieces) => pieces.join(''))

/** Replace the creditor block of the fuzz template with raw XML. */
function withFuzzCreditorXml(rawCreditorXml: string): string {
  return FUZZ_TEMPLATE.replace(CREDITOR_BLOCK, rawCreditorXml)
}

const arbOptionalFuzzPart = fc.oneof(fc.constant(''), arbFuzzPart)
const arbCreditorName = fc.oneof(
  arbFuzzPart,
  fc.tuple(arbTextPart, arbTextPart).map(([edge, inner]) => `${edge}Maja${inner}Stupica${edge}`)
)
const arbCreditorDocument = fc
  .tuple(arbOptionalFuzzPart, arbCreditorName, arbOptionalFuzzPart)
  .map(([before, name, after]) =>
    withFuzzCreditorXml(`<Cdtr>${before}<Nm>${name}</Nm>${after}</Cdtr>`)
  )
const FUZZ_ANCHORS = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<GrpHdr>',
  '</GrpHdr>',
  '<Cdtr>',
  '<RmtInf>',
  '</Document>',
]
const arbAnywhereDocument = fc
  .tuple(fc.constantFrom(...FUZZ_ANCHORS), fc.boolean(), arbFuzzPart)
  .map(([anchor, before, part]) =>
    FUZZ_TEMPLATE.replace(anchor, before ? part + anchor : anchor + part)
  )

/** Every element of the fuzz template whose text the model holds, as written. */
const FUZZ_TEXT_ELEMENTS = [
  '<MsgId>HARDEN-CT-001</MsgId>',
  '<CreDtTm>2024-06-01T09:00:00Z</CreDtTm>',
  '<Nm>Test Initiator</Nm>',
  '<PmtInfId>BATCH-001</PmtInfId>',
  '<Dt>2024-06-05</Dt>',
  '<Nm>Test Debtor</Nm>',
  '<IBAN>DE89370400440532013000</IBAN>',
  '<BICFI>COBADEFFXXX</BICFI>',
  '<EndToEndId>E2E-0001</EndToEndId>',
  '<InstdAmt Ccy="EUR">1.00</InstdAmt>',
  '<Nm>Test Creditor</Nm>',
  '<IBAN>DE65200400300234567000</IBAN>',
  USTRD,
]
const arbTextFieldDocument = fc
  .record({
    element: fc.constantFrom(...FUZZ_TEXT_ELEMENTS),
    before: arbTextPart,
    middle: arbTextPart,
    after: arbTextPart,
    at: fc.nat(),
  })
  .map(({ element, before, middle, after, at }) => {
    const open = element.slice(0, element.indexOf('>') + 1)
    const close = element.slice(element.lastIndexOf('<'))
    const value = element.slice(open.length, element.length - close.length)
    const split = at % (value.length + 1)
    const text = `${before}${value.slice(0, split)}${middle}${value.slice(split)}${after}`
    return FUZZ_TEMPLATE.replace(element, `${open}${text}${close}`)
  })

const HIDDEN_NAME = '<Nm>Maja &#x160;tupica</Nm>'
const HIDDEN_HTML_NAME = '<Nm>Maja &euro; Stupica</Nm>'

/** Creditor content where fast-xml-parser and libxml2 used to disagree, as editable pieces. */
const DIFFERENTIAL_SEEDS: ReadonlyArray<readonly string[]> = [
  ['<?pi x=', '"', '?>', '<!--', '"', '?>', HIDDEN_NAME, '-->'],
  ['<?pi x=', '"', '?>', '<!--', '"', '?>', HIDDEN_HTML_NAME, '<!-- -->'],
  ['<?pi x=', "'", '?>', '<![CDATA[', "'", '?>', HIDDEN_NAME, ']]>'],
  ['<?pi x=', '"', '?>', HIDDEN_NAME, '"', '?>'],
  ['<![X[', ' > ', '<!--', ' ]]>', HIDDEN_NAME, '<!-- -->'],
  ['<![X[', ' > ', '<!--', ' ]]>', HIDDEN_HTML_NAME, '<!-- -->'],
  ['<!--', '"', '-->', HIDDEN_NAME],
  ['<Nm>Maja ', '<![CDATA[Stupica]]>', '</Nm>'],
  ['<Nm>Maja', ' ', '</Nm>'],
  ['<Nm >', 'Hidden', '</Nm >', '<Nm>Maja</Nm>'],
]
const arbEdit = fc.record({
  at: fc.nat(),
  piece: fc.oneof(arbFuzzPiece, fc.constantFrom(...FUZZ_TEXT_PIECES)),
  kind: fc.constantFrom('insert', 'replace', 'delete'),
})
const arbSeededDocument = fc
  .tuple(fc.constantFrom(...DIFFERENTIAL_SEEDS), fc.array(arbEdit, { maxLength: 3 }))
  .map(([seed, edits]) => {
    const pieces = [...seed]
    for (const { at, piece, kind } of edits) {
      const index = at % (pieces.length + 1)
      if (kind === 'insert') pieces.splice(index, 0, piece)
      else pieces.splice(index, 1, ...(kind === 'replace' ? [piece] : []))
    }
    return withFuzzCreditorXml(`<Cdtr>${pieces.join('')}</Cdtr>`)
  })

/** Run the differential over generated documents; at least one must parse (the fuzz is not vacuous). */
function assertDifferential(arbitrary: fc.Arbitrary<string>): void {
  let accepted = 0
  fc.assert(
    fc.property(arbitrary, (xml) => {
      expectParseAgreesWithLibxml2(xml)
      if (parse(xml).ok) accepted++
    }),
    { numRuns: 300 }
  )
  expect(accepted).toBeGreaterThan(0)
}

describe('parse() agrees with libxml2 on generated documents (differential fuzz)', () => {
  it('property: markup around and inside the creditor name (numRuns=300)', () => {
    assertDifferential(arbCreditorDocument)
  })

  it('property: edits of the known differentials, PI quotes and pseudo CDATA (numRuns=300)', () => {
    assertDifferential(arbSeededDocument)
  })

  it('property: markup in the prolog, the epilog and between elements (numRuns=300)', () => {
    assertDifferential(arbAnywhereDocument)
  })

  it('property: whitespace, CDATA, PIs, comments and a second element in every modelled text field (numRuns=300)', () => {
    assertDifferential(arbTextFieldDocument)
  })
})

// ---------------------------------------------------------------------------
// Adversarial input runs in linear time
// ---------------------------------------------------------------------------

describe('namespace detection and parse run in linear time', () => {
  const MEGABYTE = 1 << 20
  const TIME_BOUND_MS = 1000
  const base = writeCreditTransfer(MINIMAL_CT)
  const inputs: Record<string, string> = {
    'comment openers after the root start tag': base.slice(0, 200) + '<!--'.repeat(MEGABYTE / 4),
    'comment openers in the prolog': '<!--'.repeat(MEGABYTE / 4),
    'comment openers inside a CDATA section': base.replace(
      '</GrpHdr>',
      `<Unmodelled><![CDATA[${'<!--'.repeat(MEGABYTE / 4)}]]></Unmodelled></GrpHdr>`
    ),
    'Document tag openers': '<Document'.repeat(MEGABYTE / 9),
    'processing instruction openers': '<?'.repeat(MEGABYTE / 2),
    'attributes on the root': `<Document${' a="1"'.repeat(MEGABYTE / 6)}>`,
    'an unterminated attribute value': `<Document xmlns="${'a'.repeat(MEGABYTE)}`,
  }

  it('should detect the namespace and parse 1 MB adversarial inputs within a second each', () => {
    for (const [label, xml] of Object.entries(inputs)) {
      const started = performance.now()
      detectSepaNamespace(xml)
      const result = parse(xml)
      expect(performance.now() - started, label).toBeLessThan(TIME_BOUND_MS)
      expect(result.ok, label).toBe(label === 'comment openers inside a CDATA section')
    }
  })

  it('should select the schema for 1 MB of comment openers inside CDATA within a second', async () => {
    const xml = inputs['comment openers inside a CDATA section'] ?? ''
    await validateXsd(base)
    const started = performance.now()
    const result = await validateXsd(xml)
    expect(performance.now() - started).toBeLessThan(TIME_BOUND_MS)
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('Unmodelled')
  })
})

// ---------------------------------------------------------------------------
// Very large documents: the scan never runs out of stack
// ---------------------------------------------------------------------------

describe('parse() reads very large documents without throwing', () => {
  const SIXTEEN_MEGABYTES = 16 << 20
  const LARGE_INPUT_TIME_BOUND_MS = 20_000
  const base = writeCreditTransfer(MINIMAL_CT)

  /** The minimal pain.001 with SplmtryData/Envlp holding an element of another namespace. */
  function withSupplementaryData(attachment: string): string {
    return base.replace(
      '</CdtTrfTxInf>',
      `<SplmtryData><Envlp>${attachment}</Envlp></SplmtryData></CdtTrfTxInf>`
    )
  }

  function expectParsedWithinBound(xml: string, label: string): void {
    const started = performance.now()
    const result = parse(xml)
    expect(performance.now() - started, label).toBeLessThan(LARGE_INPUT_TIME_BOUND_MS)
    expect(result.ok, result.ok ? label : `${label}: ${result.error}`).toBe(true)
    if (result.ok && result.type === 'pain.001') {
      expect(result.data.batches[0]?.transfers[0]?.creditor.name, label).toBe('Test Creditor')
    }
  }

  it('should parse an XSD-valid file with 8,388,600 base64 characters in SplmtryData (review repro)', async () => {
    const xml = withSupplementaryData(
      `<Att xmlns="urn:example:att">${'QUJD'.repeat(8_388_600 / 4)}</Att>`
    )
    expect(await validateXsd(xml)).toEqual({ valid: true, errors: [] })
    expectParsedWithinBound(xml, 'base64 attachment')
  })

  it('should parse 16 MB text runs of base64, of "]" and of astral characters', () => {
    const runs: Record<string, string> = {
      base64: 'QUJD'.repeat(SIXTEEN_MEGABYTES / 4),
      'closing brackets': ']'.repeat(SIXTEEN_MEGABYTES),
      'bracket pairs': ']]x'.repeat(SIXTEEN_MEGABYTES / 3),
      'astral characters': '\u{1F600}'.repeat(SIXTEEN_MEGABYTES / 2),
    }
    for (const [label, text] of Object.entries(runs)) {
      expectParsedWithinBound(
        withSupplementaryData(`<Att xmlns="urn:example:att">${text}</Att>`),
        label
      )
    }
  })

  it('should parse 16 MB element and attribute names of astral characters', () => {
    const name = '\u{10000}'.repeat(SIXTEEN_MEGABYTES / 2)
    expectParsedWithinBound(withSupplementaryData(`<${name} xmlns="urn:example:att"/>`), 'element')
    expectParsedWithinBound(
      withSupplementaryData(`<Att xmlns="urn:example:att" ${name}="1"/>`),
      'attribute'
    )
  })

  it('should reject numeric references with 16 MB of leading zeros and a stray letter in linear time', () => {
    const zeros = '0'.repeat(SIXTEEN_MEGABYTES)
    for (const reference of [`&#x${zeros}g;`, `&#${zeros}a;`]) {
      const started = performance.now()
      expect(parseError(withCreditorNameXml(reference))).toMatch(
        /^XML parse error: malformed character reference "&#x?0{38,40}\.\.\.;"/
      )
      expect(performance.now() - started).toBeLessThan(LARGE_INPUT_TIME_BOUND_MS)
    }
  })
})
