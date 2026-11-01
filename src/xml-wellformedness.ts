/**
 * Well-formedness scan for SEPA XML input, run by parse() (src/parser/parser.ts)
 * before the XML reaches fast-xml-parser.
 *
 * fast-xml-parser is lenient: it does not match end tags to start tags, ends a
 * processing instruction at the first "?>" outside quotes, reads any "<![" as a CDATA
 * section and keeps text outside the root element. Where it splits a document
 * differently from an XML 1.0 parser such as libxml2, the model could receive text a
 * bank's parser never sees. This scan accepts only documents that are well-formed XML
 * 1.0 with namespaces and without a DTD, and rejects the one well-formed construct
 * fast-xml-parser reads differently: a processing instruction with a quote that is
 * still open at its "?>".
 */

import { isXmlChar, readReferenceAt } from './xml-references.js'

const COLON = 0x3a
const NAME_START_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x41, 0x5a],
  [0x5f, 0x5f],
  [0x61, 0x7a],
  [0xc0, 0xd6],
  [0xd8, 0xf6],
  [0xf8, 0x2ff],
  [0x370, 0x37d],
  [0x37f, 0x1fff],
  [0x200c, 0x200d],
  [0x2070, 0x218f],
  [0x2c00, 0x2fef],
  [0x3001, 0xd7ff],
  [0xf900, 0xfdcf],
  [0xfdf0, 0xfffd],
  [0x10000, 0xeffff],
]
const NAME_RANGES: ReadonlyArray<readonly [number, number]> = [
  ...NAME_START_RANGES,
  [0x2d, 0x2e],
  [0x30, 0x39],
  [0xb7, 0xb7],
  [0x300, 0x36f],
  [0x203f, 0x2040],
]

const S = '[ \\t\\r\\n]'
const OPTIONAL_WHITESPACE = new RegExp(`${S}*`, 'y')
const VERSION_INFO = `${S}+version${S}*=${S}*(?:"1\\.[0-9]+"|'1\\.[0-9]+')`
const ENCODING_DECL = `${S}+encoding${S}*=${S}*(?:"[A-Za-z][A-Za-z0-9._-]*"|'[A-Za-z][A-Za-z0-9._-]*')`
const STANDALONE_DECL = `${S}+standalone${S}*=${S}*(?:"(?:yes|no)"|'(?:yes|no)')`
const XML_DECLARATION = new RegExp(
  `<\\?xml${VERSION_INFO}(?:${ENCODING_DECL})?(?:${STANDALONE_DECL})?${S}*\\?>`,
  'y'
)

const ATTRIBUTE_TEXT: Readonly<Record<string, RegExp>> = { '"': /[^"<&]*/y, "'": /[^'<&]*/y }
const JS_WHITESPACE = /\s/

const BYTE_ORDER_MARK = '﻿'
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/'
const XMLNS = 'xmlns'
const XMLNS_PREFIX = 'xmlns:'

class NotWellFormedError extends Error {}

interface Attribute {
  name: string
  value: string
}

interface OpenElement {
  name: string
  declaredPrefixes: string[]
}

function matchAt(pattern: RegExp, text: string, index: number): string | null {
  pattern.lastIndex = index
  return pattern.exec(text)?.[0] ?? null
}

function describeCodePoint(character: string): string {
  return `U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`
}

function hasOpenQuote(text: string, from: number, to: number): boolean {
  let quote = ''
  for (let i = from; i < to; i++) {
    const character = text.charAt(i)
    if (quote !== '') {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    }
  }
  return quote !== ''
}

function prefixOf(qualifiedName: string): string | null {
  const colon = qualifiedName.indexOf(':')
  return colon === -1 ? null : qualifiedName.slice(0, colon)
}

function isInRanges(codePoint: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  return ranges.some(([low, high]) => codePoint >= low && codePoint <= high)
}

/** The position of the first character that XML 1.0 does not allow, or -1. */
function firstIllegalCharacter(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const codePoint = text.codePointAt(i) ?? 0
    if (!isXmlChar(codePoint)) return i
    if (codePoint > 0xffff) i += 1
  }
  return -1
}

/** Whether a Name (a match of readName) is also a QName: NCName, optionally prefixed. */
function isQualifiedName(name: string): boolean {
  const colon = name.indexOf(':')
  if (colon === -1) return true
  if (colon === 0 || name.indexOf(':', colon + 1) !== -1) return false
  return isInRanges(name.codePointAt(colon + 1) ?? -1, NAME_START_RANGES)
}

class DocumentScan {
  private index = 0
  private readonly openElements: OpenElement[] = []
  private readonly namespaceBindings = new Map<string, string[]>([['xml', [XML_NAMESPACE]]])

  constructor(private readonly xml: string) {}

  run(): void {
    const illegal = firstIllegalCharacter(this.xml)
    if (illegal !== -1) {
      this.fail(
        `the character ${describeCodePoint(this.xml.charAt(illegal))} is not allowed in XML`
      )
    }
    if (this.xml.startsWith(BYTE_ORDER_MARK)) this.index = 1
    this.readXmlDeclaration()
    this.skipMisc()
    if (this.index >= this.xml.length) this.fail('the document has no root element')
    if (this.xml.charAt(this.index) !== '<') this.fail('text before the root element')
    this.readStartTag()
    let element = this.openElements.at(-1)
    while (element !== undefined) {
      this.readContent(element)
      element = this.openElements.at(-1)
    }
    this.skipMisc()
    if (this.index < this.xml.length) this.fail('content after the end of the root element')
  }

  private fail(problem: string): never {
    throw new NotWellFormedError(problem)
  }

  private startsWith(text: string): boolean {
    return this.xml.startsWith(text, this.index)
  }

  private skipWhitespace(): number {
    const whitespace = matchAt(OPTIONAL_WHITESPACE, this.xml, this.index) ?? ''
    this.index += whitespace.length
    return whitespace.length
  }

  private readName(at: number): string | null {
    let end = at
    for (;;) {
      const codePoint = this.xml.codePointAt(end)
      if (codePoint === undefined) break
      const ranges = end === at ? NAME_START_RANGES : NAME_RANGES
      if (codePoint !== COLON && !isInRanges(codePoint, ranges)) break
      end += codePoint > 0xffff ? 2 : 1
    }
    return end === at ? null : this.xml.slice(at, end)
  }

  /**
   * Read the Name of an element or an attribute. fast-xml-parser ends these names at any
   * character JS matches with \s, so a Name that holds one (U+1680 and U+FEFF are XML name
   * characters) is rejected: fast-xml-parser would read a different element or attribute.
   */
  private readTagName(at: number): string | null {
    const name = this.readName(at)
    const space = name === null ? null : JS_WHITESPACE.exec(name)
    if (space !== null) {
      this.fail(
        `the name "${name}" contains ${describeCodePoint(space[0])}, a Unicode space that parse does not accept in element and attribute names`
      )
    }
    return name
  }

  private readXmlDeclaration(): void {
    if (!this.startsWith('<?') || this.readName(this.index + 2) !== 'xml') return
    const declaration = matchAt(XML_DECLARATION, this.xml, this.index)
    if (declaration === null) this.fail('malformed XML declaration')
    this.index += declaration.length
  }

  private skipMisc(): void {
    for (;;) {
      this.skipWhitespace()
      if (this.startsWith('<!--')) this.readComment()
      else if (this.startsWith('<?')) this.readProcessingInstruction()
      else return
    }
  }

  private skipCharacterData(): void {
    let i = this.index
    for (; i < this.xml.length; i++) {
      const character = this.xml.charAt(i)
      if (character === '<' || character === '&') break
      if (character === ']' && this.xml.startsWith(']]>', i)) break
    }
    this.index = i
  }

  private readContent(element: OpenElement): void {
    this.skipCharacterData()
    const character = this.xml.charAt(this.index)
    if (character === '') this.fail(`unterminated element <${element.name}>`)
    if (character === ']') this.fail('"]]>" is not allowed in text (write > as &gt;)')
    if (character === '&') this.readReference()
    else this.readMarkup(element)
  }

  private readMarkup(element: OpenElement): void {
    if (this.startsWith('<!--')) this.readComment()
    else if (this.startsWith('<![CDATA[')) this.readCdataSection()
    else if (this.startsWith('<![')) this.fail('"<![" must start a CDATA section (<![CDATA[)')
    else if (this.startsWith('<!')) this.fail('unexpected "<!" (comments start with <!--)')
    else if (this.startsWith('<?')) this.readProcessingInstruction()
    else if (this.startsWith('</')) this.readEndTag(element)
    else this.readStartTag()
  }

  private readReference(): string {
    const read = readReferenceAt(this.xml, this.index)
    if ('problem' in read) this.fail(read.problem)
    this.index = read.end
    return read.text
  }

  private readComment(): void {
    const end = this.xml.indexOf('-->', this.index + 4)
    if (end === -1) this.fail('unterminated comment')
    if (this.xml.indexOf('--', this.index + 4) !== end) {
      this.fail('"--" is not allowed inside a comment')
    }
    this.index = end + 3
  }

  private readCdataSection(): void {
    const end = this.xml.indexOf(']]>', this.index + 9)
    if (end === -1) this.fail('unterminated CDATA section')
    this.index = end + 3
  }

  private readProcessingInstruction(): void {
    const start = this.index
    const target = this.readName(start + 2)
    if (target === null) this.fail('processing instruction without a target name')
    if (target.toLowerCase() === 'xml') {
      this.fail(
        `reserved processing instruction target "${target}" (an XML declaration must come first)`
      )
    }
    if (target.includes(':')) this.fail(`processing instruction target "${target}" has a colon`)
    this.index = start + 2 + target.length
    const end = this.xml.indexOf('?>', this.index)
    if (end === -1) this.fail('unterminated processing instruction')
    if (end !== this.index && this.skipWhitespace() === 0) {
      this.fail(`processing instruction target "${target}" must be followed by whitespace`)
    }
    if (hasOpenQuote(this.xml, start, end)) {
      this.fail(`processing instruction "<?${target}" has a quote that is not closed before "?>"`)
    }
    this.index = end + 2
  }

  private readStartTag(): void {
    const name = this.readTagName(this.index + 1)
    if (name === null) this.fail('unescaped "<" (write it as &lt;)')
    this.index += 1 + name.length
    const attributes = this.readAttributes(name)
    const element = { name, declaredPrefixes: this.bindNamespaces(attributes) }
    this.checkNamespaces(name, attributes)
    if (this.startsWith('/>')) {
      this.index += 2
      this.unbindNamespaces(element)
    } else {
      this.index += 1
      this.openElements.push(element)
    }
  }

  private readAttributes(element: string): Attribute[] {
    const attributes: Attribute[] = []
    const names = new Set<string>()
    for (;;) {
      const separated = this.skipWhitespace() > 0
      if (this.startsWith('>') || this.startsWith('/>')) return attributes
      this.expectInTag(separated, `malformed start tag <${element}>`)
      const attribute = this.readAttribute(element)
      if (names.has(attribute.name)) {
        this.fail(`attribute ${attribute.name} is repeated on <${element}>`)
      }
      names.add(attribute.name)
      attributes.push(attribute)
    }
  }

  private expectInTag(condition: boolean, problem: string): asserts condition {
    if (this.index >= this.xml.length) this.fail('unterminated tag')
    if (!condition) this.fail(problem)
  }

  private readAttribute(element: string): Attribute {
    const name = this.readTagName(this.index)
    this.expectInTag(name !== null, `malformed start tag <${element}>`)
    this.index += name.length
    this.skipWhitespace()
    this.expectInTag(this.startsWith('='), `attribute ${name} of <${element}> has no value`)
    this.index += 1
    this.skipWhitespace()
    const quote = this.xml.charAt(this.index)
    const text = ATTRIBUTE_TEXT[quote]
    this.expectInTag(text !== undefined, `attribute ${name} of <${element}> needs a quoted value`)
    this.index += 1
    return { name, value: this.readAttributeValue(quote, text) }
  }

  private readAttributeValue(quote: string, text: RegExp): string {
    let value = ''
    for (;;) {
      const chunk = matchAt(text, this.xml, this.index) ?? ''
      value += chunk
      this.index += chunk.length
      const character = this.xml.charAt(this.index)
      if (character === quote) {
        this.index += 1
        return value
      }
      if (character === '') this.fail('unterminated tag')
      if (character === '<') this.fail('unescaped "<" in an attribute value (write it as &lt;)')
      value += this.readReference()
    }
  }

  private readEndTag(element: OpenElement): void {
    const name = this.readTagName(this.index + 2)
    if (name === null) this.fail('malformed end tag')
    this.index += 2 + name.length
    this.skipWhitespace()
    this.expectInTag(this.startsWith('>'), `malformed end tag </${name}>`)
    this.index += 1
    if (element.name !== name) this.fail(`end tag </${name}> does not match <${element.name}>`)
    this.openElements.pop()
    this.unbindNamespaces(element)
  }

  private bindNamespaces(attributes: readonly Attribute[]): string[] {
    const declared: string[] = []
    for (const { name, value } of attributes) {
      if (name === XMLNS) this.checkNamespaceDeclaration(null, value)
      if (!name.startsWith(XMLNS_PREFIX)) continue
      if (!isQualifiedName(name)) this.fail(`malformed namespace declaration ${name}`)
      const prefix = name.slice(XMLNS_PREFIX.length)
      this.checkNamespaceDeclaration(prefix, value)
      if (prefix === 'xml') continue
      const bindings = this.namespaceBindings.get(prefix) ?? []
      bindings.push(value)
      this.namespaceBindings.set(prefix, bindings)
      declared.push(prefix)
    }
    return declared
  }

  /**
   * The reserved names of Namespaces in XML 1.0 (section 3): the xml prefix and its
   * namespace belong to each other only, the xmlns prefix and its namespace are never
   * declared, and only the default namespace may be empty. The URI is the attribute value
   * after reference decoding.
   *
   * @param prefix the declared prefix, or null for the default namespace (xmlns="...")
   */
  private checkNamespaceDeclaration(prefix: string | null, uri: string): void {
    if (prefix === XMLNS) this.fail('the xmlns prefix cannot be declared')
    if (uri === XMLNS_NAMESPACE) this.fail(`the namespace ${XMLNS_NAMESPACE} cannot be declared`)
    if ((prefix === 'xml') !== (uri === XML_NAMESPACE)) {
      this.fail(`only the xml prefix is bound to ${XML_NAMESPACE}`)
    }
    if (uri === '' && prefix !== null) {
      this.fail(`namespace prefix ${prefix} cannot be bound to an empty namespace`)
    }
  }

  private unbindNamespaces(element: OpenElement): void {
    for (const prefix of element.declaredPrefixes) {
      this.namespaceBindings.get(prefix)?.pop()
    }
  }

  private checkNamespaces(element: string, attributes: readonly Attribute[]): void {
    this.resolve(element)
    const expandedNames = new Set<string>()
    for (const { name } of attributes) {
      if (name === XMLNS || name.startsWith(XMLNS_PREFIX)) continue
      const namespace = this.resolve(name)
      if (namespace === null) continue
      const expanded = `{${namespace}}${name.slice(name.indexOf(':') + 1)}`
      if (expandedNames.has(expanded)) {
        this.fail(`attribute ${expanded} is repeated on <${element}>`)
      }
      expandedNames.add(expanded)
    }
  }

  private resolve(qualifiedName: string): string | null {
    if (!isQualifiedName(qualifiedName)) {
      this.fail(`"${qualifiedName}" is not a valid qualified name`)
    }
    const prefix = prefixOf(qualifiedName)
    if (prefix === null) return null
    const namespace = this.namespaceBindings.get(prefix)?.at(-1)
    if (namespace === undefined) this.fail(`namespace prefix ${prefix} is not declared`)
    return namespace
  }
}

/**
 * Find the first reason a document is not well-formed XML 1.0 with namespaces (or would
 * be read differently by fast-xml-parser), scanning it once from start to end.
 *
 * @param xml the raw XML string (a DTD is rejected as unexpected markup)
 * @returns a description of the first problem, or null if the document is well-formed
 */
export function findWellFormednessProblem(xml: string): string | null {
  try {
    new DocumentScan(xml).run()
    return null
  } catch (e) {
    if (e instanceof NotWellFormedError) return e.message
    throw e
  }
}
