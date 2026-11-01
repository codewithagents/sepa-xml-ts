/**
 * Entity and character reference guard for SEPA XML input, run by parse()
 * (src/parser/parser.ts) before the XML reaches fast-xml-parser.
 *
 * SEPA documents carry no DTD, so the only well-formed references are the five
 * predefined entities and numeric character references to a legal XML 1.0 Char.
 * The parser decodes exactly those. Anything else (a bare "&", an HTML entity such
 * as &nbsp;, &#0;) is not well-formed XML and is rejected here, so it can never
 * reach the decoder or survive as literal text in the model.
 *
 * The scan follows the XML structure: comments, CDATA sections and processing
 * instructions are skipped only where they start in content, and attribute values
 * are checked like content (references are expanded there too).
 */

const PREDEFINED_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos'])

const MAX_HEX_DIGITS = 8
const MAX_DECIMAL_DIGITS = 10

const SECTIONS_WITHOUT_REFERENCES = [
  { open: '<!--', close: '-->', name: 'comment' },
  { open: '<![CDATA[', close: ']]>', name: 'CDATA section' },
  { open: '<?', close: '?>', name: 'processing instruction' },
] as const

const REFERENCE_TOKEN = /&([^\s&;<>"']+);/y
const NEXT_MARKUP = /[&<]/g

const HEX_REFERENCE = /^#x([0-9A-Fa-f]+)$/
const DECIMAL_REFERENCE = /^#([0-9]+)$/

type ScanStep = { next: number } | { problem: string }

function isXmlChar(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  )
}

function checkNumericReference(token: string): string | null {
  const reference = `&${token};`
  const hex = HEX_REFERENCE.exec(token)
  const decimal = DECIMAL_REFERENCE.exec(token)
  const digits = hex?.[1] ?? decimal?.[1]
  if (digits === undefined) {
    return `malformed character reference "${reference}" (expected &#NNN; or &#xHHHH;)`
  }
  const maxDigits = hex !== null ? MAX_HEX_DIGITS : MAX_DECIMAL_DIGITS
  if (digits.length > maxDigits) {
    return `character reference "${reference}" has more than ${maxDigits} digits`
  }
  const codePoint = Number.parseInt(digits, hex !== null ? 16 : 10)
  if (!isXmlChar(codePoint)) {
    return `character reference "${reference}" is not a legal XML character`
  }
  return null
}

function checkReferenceAt(xml: string, index: number): string | null {
  REFERENCE_TOKEN.lastIndex = index
  const token = REFERENCE_TOKEN.exec(xml)?.[1]
  if (token === undefined) {
    return 'unescaped "&" (write it as &amp;)'
  }
  if (token.startsWith('#')) {
    return checkNumericReference(token)
  }
  if (PREDEFINED_ENTITIES.has(token)) {
    return null
  }
  return `undefined entity reference "&${token};": without a DTD only &amp; &lt; &gt; &quot; &apos; and numeric character references are allowed`
}

function skipSection(xml: string, index: number): ScanStep | null {
  for (const section of SECTIONS_WITHOUT_REFERENCES) {
    if (xml.startsWith(section.open, index)) {
      const end = xml.indexOf(section.close, index + section.open.length)
      return end === -1
        ? { problem: `unterminated ${section.name}` }
        : { next: end + section.close.length }
    }
  }
  return null
}

function scanTagCharacter(xml: string, index: number, quote: string | null): string | null {
  const character = xml.charAt(index)
  if (character === '&') {
    return checkReferenceAt(xml, index)
  }
  if (quote !== null && character === '<') {
    return 'unescaped "<" in an attribute value (write it as &lt;)'
  }
  return null
}

function scanTag(xml: string, index: number): ScanStep {
  let quote: string | null = null
  for (let i = index + 1; i < xml.length; i++) {
    const problem = scanTagCharacter(xml, i, quote)
    if (problem !== null) return { problem }
    const character = xml.charAt(i)
    if (quote !== null) {
      if (character === quote) quote = null
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return { next: i + 1 }
    }
  }
  return { problem: 'unterminated tag' }
}

function scanMarkup(xml: string, index: number): ScanStep {
  if (xml.charAt(index) === '&') {
    const problem = checkReferenceAt(xml, index)
    return problem === null ? { next: index + 1 } : { problem }
  }
  return skipSection(xml, index) ?? scanTag(xml, index)
}

/**
 * Find the first entity or character reference that is not well-formed in a
 * document without a DTD, in content and in attribute values. Comments, CDATA
 * sections and processing instructions are skipped, because XML does not expand
 * references inside them; an unterminated one is reported.
 *
 * @param xml the raw XML string
 * @returns a description of the first problem, or null if every reference is valid
 */
export function findInvalidReference(xml: string): string | null {
  NEXT_MARKUP.lastIndex = 0
  let match = NEXT_MARKUP.exec(xml)
  while (match !== null) {
    const step = scanMarkup(xml, match.index)
    if ('problem' in step) {
      return step.problem
    }
    NEXT_MARKUP.lastIndex = step.next
    match = NEXT_MARKUP.exec(xml)
  }
  return null
}
