/**
 * Shared xmlns detection helper for SEPA XML documents.
 *
 * Used by both the public parse() path (src/parser/parser.ts) and the XSD
 * validation path (src/xsd.ts) so that the detection logic stays in sync.
 *
 * The namespace is read from the root element only: the prolog (byte order mark,
 * XML declaration, comments, processing instructions, whitespace) is skipped, and the
 * first element after it must be <Document>. A namespace written in a comment or a
 * processing instruction before the root, or anywhere after the root start tag, can
 * never steer detection. Every step moves forward through the string, so detection is
 * linear in the input length.
 */

const BYTE_ORDER_MARK = '﻿'
const WHITESPACE = /[ \t\r\n]*/y
const DOCUMENT_START_TAG = /<Document(?=[ \t\r\n/>])/y
const ATTRIBUTE = /[ \t\r\n]+([^\s=/>"']+)[ \t\r\n]*=[ \t\r\n]*(?:"([^"]*)"|'([^']*)')/y

const PROLOG_SECTIONS = [
  { open: '<!--', close: '-->' },
  { open: '<?', close: '?>' },
] as const

function skipWhitespace(xml: string, index: number): number {
  WHITESPACE.lastIndex = index
  return index + (WHITESPACE.exec(xml)?.[0].length ?? 0)
}

/** The position of the root element's "<", or null when the prolog is unterminated. */
function rootElementStart(xml: string): number | null {
  let index = xml.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK.length : 0
  for (;;) {
    index = skipWhitespace(xml, index)
    const section = PROLOG_SECTIONS.find(({ open }) => xml.startsWith(open, index))
    if (section === undefined) return index
    const end = xml.indexOf(section.close, index + section.open.length)
    if (end === -1) return null
    index = end + section.close.length
  }
}

/**
 * Detect the ISO 20022 namespace declared on the root <Document> element.
 *
 * Returns the namespace URI string, or null if the root element is not <Document>
 * or carries no (or an empty) default xmlns attribute.
 */
export function detectSepaNamespace(xml: string): string | null {
  const start = rootElementStart(xml)
  if (start === null) return null
  DOCUMENT_START_TAG.lastIndex = start
  if (DOCUMENT_START_TAG.exec(xml) === null) return null
  ATTRIBUTE.lastIndex = DOCUMENT_START_TAG.lastIndex
  for (let attribute = ATTRIBUTE.exec(xml); attribute !== null; attribute = ATTRIBUTE.exec(xml)) {
    if (attribute[1] === 'xmlns') {
      const namespace = attribute[2] ?? attribute[3] ?? ''
      return namespace === '' ? null : namespace
    }
  }
  return null
}
