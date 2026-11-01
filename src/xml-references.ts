/**
 * Entity and character reference guard for SEPA XML input, run by parse()
 * (src/parser/parser.ts) before the XML reaches fast-xml-parser.
 *
 * SEPA documents carry no DTD, so the only well-formed references are the five
 * predefined entities and numeric character references to a legal XML 1.0 Char.
 * The parser decodes exactly those. Anything else (a bare "&", an HTML entity such
 * as &nbsp;, &#0;) is not well-formed XML and is rejected here, so it can never
 * reach the decoder or survive as literal text in the model.
 */

const PREDEFINED_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos'])

const MAX_HEX_DIGITS = 8
const MAX_DECIMAL_DIGITS = 10

const SECTIONS_WITHOUT_REFERENCES = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g

const REFERENCE_TOKEN = /&([^\s&;<>"']+);/y

const HEX_REFERENCE = /^#x([0-9A-Fa-f]+)$/
const DECIMAL_REFERENCE = /^#([0-9]+)$/

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

function checkReferenceAt(text: string, index: number): string | null {
  REFERENCE_TOKEN.lastIndex = index
  const match = REFERENCE_TOKEN.exec(text)
  const token = match?.[1]
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

/**
 * Find the first entity or character reference that is not well-formed in a
 * document without a DTD. Comments, CDATA sections and processing instructions
 * are skipped, because XML does not expand references inside them.
 *
 * @param xml the raw XML string
 * @returns a description of the first invalid reference, or null if every reference is valid
 */
export function findInvalidReference(xml: string): string | null {
  const text = xml.replace(SECTIONS_WITHOUT_REFERENCES, ' ')
  let index = text.indexOf('&')
  while (index !== -1) {
    const problem = checkReferenceAt(text, index)
    if (problem !== null) {
      return problem
    }
    index = text.indexOf('&', index + 1)
  }
  return null
}
