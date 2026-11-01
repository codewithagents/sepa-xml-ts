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
        base.replace('<Cdtr>', '<Cdtr xmlns:p="">'),
        'namespace prefix p cannot be bound to an empty namespace',
      ],
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
// Differential fuzz: parse against libxml2
// ---------------------------------------------------------------------------

type Libxml2Reading = { wellFormed: true; creditorName: string | null } | { wellFormed: false }

/** What libxml2 reads: whether the document is well-formed, and the first creditor name. */
function libxml2Read(xml: string): Libxml2Reading {
  let doc: XmlDocument
  try {
    doc = XmlDocument.fromString(xml, { option: ParseOption.XML_PARSE_NO_XXE })
  } catch (e) {
    if (e instanceof XmlParseError) return { wellFormed: false }
    throw e
  }
  try {
    const name = doc.get("(//*[local-name()='Cdtr'])[1]/*[local-name()='Nm']")
    return { wellFormed: true, creditorName: name === null ? null : name.content }
  } finally {
    doc[Symbol.dispose]()
  }
}

const FUZZ_CHARACTERS = [...'<?![]>"\'-&#;x0123456789/=:A']
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
const arbFuzzPiece = fc.oneof(fc.constantFrom(...FUZZ_CHARACTERS), fc.constantFrom(...FUZZ_TOKENS))
const arbFuzzPart = fc.array(arbFuzzPiece, { maxLength: 8 }).map((pieces) => pieces.join(''))
const arbCreditorDocument = fc
  .tuple(arbFuzzPart, arbFuzzPart, arbFuzzPart)
  .map(([before, name, after]) => withCreditorXml(`<Cdtr>${before}<Nm>${name}</Nm>${after}</Cdtr>`))
const FUZZ_ANCHORS = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<GrpHdr>',
  '</GrpHdr>',
  '<Cdtr>',
  '</Document>',
]
const arbAnywhereDocument = fc
  .tuple(fc.constantFrom(...FUZZ_ANCHORS), fc.boolean(), arbFuzzPart)
  .map(([anchor, before, part]) =>
    writeCreditTransfer(MINIMAL_CT).replace(anchor, before ? part + anchor : anchor + part)
  )

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
]
const arbEdit = fc.record({
  at: fc.nat(),
  piece: arbFuzzPiece,
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
    return withCreditorXml(`<Cdtr>${pieces.join('')}</Cdtr>`)
  })

function expectParseAgreesWithLibxml2(xml: string): void {
  const libxml2 = libxml2Read(xml)
  const problem = findWellFormednessProblem(xml)
  if (problem === null || !problem.includes('has a quote that is not closed')) {
    expect(problem === null, `scan: ${problem}`).toBe(libxml2.wellFormed)
  }
  const result = parse(xml)
  if (!result.ok) return
  expect(libxml2.wellFormed).toBe(true)
  if (!libxml2.wellFormed || result.type !== 'pain.001') throw new Error('expected a pain.001')
  expect(result.data.batches[0]?.transfers[0]?.creditor.name).toBe(libxml2.creditorName)
}

describe('parse() agrees with libxml2 on generated documents (differential fuzz)', () => {
  it('property: markup around and inside the creditor name (numRuns=300)', () => {
    let accepted = 0
    fc.assert(
      fc.property(arbCreditorDocument, (xml) => {
        expectParseAgreesWithLibxml2(xml)
        if (parse(xml).ok) accepted++
      }),
      { numRuns: 300 }
    )
    expect(accepted).toBeGreaterThan(0)
  })

  it('property: edits of the known differentials, PI quotes and pseudo CDATA (numRuns=300)', () => {
    fc.assert(
      fc.property(arbSeededDocument, (xml) => {
        expectParseAgreesWithLibxml2(xml)
      }),
      { numRuns: 300 }
    )
  })

  it('property: markup in the prolog, the epilog and between elements (numRuns=300)', () => {
    fc.assert(
      fc.property(arbAnywhereDocument, (xml) => {
        expectParseAgreesWithLibxml2(xml)
      }),
      { numRuns: 300 }
    )
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
