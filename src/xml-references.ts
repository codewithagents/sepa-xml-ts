/**
 * Entity and character references in SEPA XML, read strictly.
 *
 * SEPA documents carry no DTD, so the only well-formed references are the five
 * predefined entities and numeric character references to a legal XML 1.0 Char.
 * readReferenceAt is the one rule for both readers of a document: the well-formedness
 * scan (src/xml-wellformedness.ts) checks every reference with it, and fast-xml-parser
 * decodes text and attribute values through XML_REFERENCE_DECODER, which uses it too.
 * Anything else (a bare "&", an HTML entity such as &nbsp;, &#0;) is rejected, so it
 * can never be decoded or survive as literal text in the model.
 */

import type { EntityDecoderOptions } from 'fast-xml-parser'

const PREDEFINED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
])

const REFERENCE_TOKEN = /&([^\s&;<>"']+);/y

const NUMERIC_REFERENCE_FORMATS = [
  { prefix: '#x', digits: /^[0-9A-Fa-f]+$/, radix: 16, maxSignificantDigits: 6 },
  { prefix: '#', digits: /^[0-9]+$/, radix: 10, maxSignificantDigits: 7 },
] as const
const FIRST_SIGNIFICANT_DIGIT = /[^0]/

const BEYOND_UNICODE = 0x110000
const MAX_SHOWN_TOKEN_LENGTH = 40

/** A reference read at a position: the text it stands for and where it ends, or why it is not well-formed. */
export type ReferenceRead = { text: string; end: number } | { problem: string }

/** Whether a code point is a legal XML 1.0 Char. */
export function isXmlChar(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  )
}

function shown(token: string): string {
  const visible =
    token.length > MAX_SHOWN_TOKEN_LENGTH ? `${token.slice(0, MAX_SHOWN_TOKEN_LENGTH)}...` : token
  return `&${visible};`
}

function codePointOf(token: string): number | null {
  const format = NUMERIC_REFERENCE_FORMATS.find(({ prefix }) => token.startsWith(prefix))
  const written = format === undefined ? '' : token.slice(format.prefix.length)
  if (format === undefined || !format.digits.test(written)) {
    return null
  }
  const first = written.search(FIRST_SIGNIFICANT_DIGIT)
  if (first === -1) {
    return 0
  }
  const significant = written.slice(first)
  return significant.length > format.maxSignificantDigits
    ? BEYOND_UNICODE
    : Number.parseInt(significant, format.radix)
}

function readNumericReference(token: string): { text: string } | { problem: string } {
  const codePoint = codePointOf(token)
  if (codePoint === null) {
    return {
      problem: `malformed character reference "${shown(token)}" (expected &#NNN; or &#xHHHH;)`,
    }
  }
  if (!isXmlChar(codePoint)) {
    return { problem: `character reference "${shown(token)}" is not a legal XML character` }
  }
  return { text: String.fromCodePoint(codePoint) }
}

function readToken(token: string): { text: string } | { problem: string } {
  if (token.startsWith('#')) {
    return readNumericReference(token)
  }
  const text = PREDEFINED_ENTITIES.get(token)
  if (text !== undefined) {
    return { text }
  }
  return {
    problem: `undefined entity reference "${shown(token)}": without a DTD only &amp; &lt; &gt; &quot; &apos; and numeric character references are allowed`,
  }
}

/**
 * Read the entity or character reference that starts with the "&" at `index`.
 *
 * @param source the text that contains the reference
 * @param index the position of the "&"
 * @returns the decoded text and the position after the ";", or a description of the problem
 */
export function readReferenceAt(source: string, index: number): ReferenceRead {
  REFERENCE_TOKEN.lastIndex = index
  const token = REFERENCE_TOKEN.exec(source)?.[1]
  if (token === undefined) {
    return { problem: 'unescaped "&" (write it as &amp;)' }
  }
  const read = readToken(token)
  return 'problem' in read ? read : { text: read.text, end: index + token.length + 2 }
}

/**
 * Decode every reference in a text or attribute value, in a single pass.
 *
 * @throws Error naming the first reference that is not well-formed without a DTD
 */
export function decodeReferences(value: string): string {
  let ampersand = value.indexOf('&')
  if (ampersand === -1) {
    return value
  }
  let decoded = ''
  let copiedUpTo = 0
  while (ampersand !== -1) {
    const read = readReferenceAt(value, ampersand)
    if ('problem' in read) {
      throw new Error(read.problem)
    }
    decoded += value.slice(copiedUpTo, ampersand) + read.text
    copiedUpTo = read.end
    ampersand = value.indexOf('&', copiedUpTo)
  }
  return decoded + value.slice(copiedUpTo)
}

/**
 * The entity decoder parse() hands to fast-xml-parser (its `entityDecoder` option), in
 * place of the HTML-entity decoder. It decodes exactly what XML without a DTD defines
 * and throws on anything else, so parse() returns ok:false. Entity declarations are
 * never honoured (parse() rejects a DOCTYPE before fast-xml-parser runs), and every
 * document is read with the XML 1.0 character rules.
 */
export const XML_REFERENCE_DECODER: EntityDecoderOptions = {
  decode: decodeReferences,
  reset: () => undefined,
  setXmlVersion: () => undefined,
  addInputEntities: () => undefined,
  setExternalEntities: () => undefined,
}
