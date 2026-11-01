/**
 * SEPA character sets as defined by EPC217-08, and the conversion between them.
 *
 * Basic Latin set (EPC Implementation Guidelines): a-z A-Z 0-9 space / - ? : ( ) . , ' +
 * Extended set: the basic set plus the green entries of the EPC217-08 SEPA conversion
 * table (src/model/epc217-08-table.ts, generated from test/fixtures/epc217-08/).
 */

import { EPC217_08_EXTENDED_ONLY, EPC217_08_TO_BASIC } from './epc217-08-table.js'

/**
 * The SEPA character sets a text field can use (EPC217-08).
 *
 * Pass one of these (or the equivalent raw string) as `{ charset }`.
 */
export const SepaCharset = {
  /**
   * The basic Latin set every SEPA bank accepts:
   * a-z A-Z 0-9, space and / - ? : ( ) . , ' +
   * The default for writing and validating.
   */
  Basic: 'basic',
  /**
   * The EPC217-08 extended set: the basic set plus the local-language and special
   * characters of the official SEPA conversion table (for example č š ž ä ß Ж € & @).
   * Use it only for text fields (names, addresses, remittance information) and only
   * when your bank has agreed to receive it. Identifiers, references and codes stay
   * basic Latin. The default for parsing.
   */
  Extended: 'extended',
} as const

/** Literal union of the supported SEPA character sets ('basic' | 'extended'). */
export type SepaCharset = (typeof SepaCharset)[keyof typeof SepaCharset]

const SEPA_BASIC = /^[a-zA-Z0-9 /\-?:().,'+]*$/

const SECTION_6_2_SENDER_FALLBACKS: ReadonlyMap<string, string> = new Map([
  ['&', '+'],
  ['@', '(at)'],
  ['€', 'E'],
  ['_', '-'],
])

const FULL_STOP = '.'

/**
 * Resolve a charset option, throwing on a value that is not a SepaCharset.
 *
 * @param value the option value as passed by the caller (may come from untyped JS)
 * @param defaultCharset the charset to use when the option is absent
 */
export function resolveSepaCharset(value: unknown, defaultCharset: SepaCharset): SepaCharset {
  if (value === undefined) {
    return defaultCharset
  }
  if (value === SepaCharset.Basic || value === SepaCharset.Extended) {
    return value
  }
  throw new Error(
    `Unknown charset "${String(value)}": expected 'basic' or 'extended' (SepaCharset.Basic, SepaCharset.Extended)`
  )
}

function isCharacterIn(character: string, charset: SepaCharset): boolean {
  return (
    SEPA_BASIC.test(character) ||
    (charset === SepaCharset.Extended && EPC217_08_EXTENDED_ONLY.has(character))
  )
}

/**
 * Returns true if the string contains only basic Latin SEPA characters.
 * An empty string is allowed (callers enforce min-length separately).
 */
export function isSepaBasic(value: string): boolean {
  return SEPA_BASIC.test(value)
}

/**
 * The distinct characters of a value that are outside a charset, in order of
 * first occurrence. Iterates by code point, so an emoji or a lone surrogate is one entry.
 */
export function offendingCharacters(value: string, charset: SepaCharset): string[] {
  const offending = new Set<string>()
  for (const character of value) {
    if (!isCharacterIn(character, charset)) {
      offending.add(character)
    }
  }
  return [...offending]
}

/**
 * Returns true if every character of the value is in the charset.
 * An empty string is allowed (callers enforce min-length separately).
 */
export function isInSepaCharset(value: string, charset: SepaCharset): boolean {
  if (SEPA_BASIC.test(value)) {
    return true
  }
  if (charset === SepaCharset.Basic) {
    return false
  }
  for (const character of value) {
    if (!isCharacterIn(character, charset)) {
      return false
    }
  }
  return true
}

const CHARSET_MESSAGE_PREFIX = 'Value contains characters outside the SEPA charset (EPC217-08)'
const BASIC_SET_DESCRIPTION = "a-z A-Z 0-9 space / - ? : ( ) . , ' +"
const MAX_LISTED_CHARACTERS = 5
const COMBINING_MARK = /\p{M}/u

function describeCharacter(character: string): string {
  const hex = (character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')
  return `"${character}" (U+${hex})`
}

function describeOffending(offending: string[]): string {
  const listed = offending.slice(0, MAX_LISTED_CHARACTERS).map(describeCharacter).join(', ')
  const more = offending.length - MAX_LISTED_CHARACTERS
  return more > 0 ? `${listed}, and ${more} more` : listed
}

function combiningMarkHint(offending: string[]): string {
  return offending.some((character) => COMBINING_MARK.test(character))
    ? " The value contains combining marks (decomposed text): normalize it with value.normalize('NFC'); toSepaCharset does this for you."
    : ''
}

function theseCharacters(count: number): string {
  return count === 1 ? 'this character is' : 'these characters are'
}

function textFieldAdvice(offending: string[], charset: SepaCharset): string {
  if (charset === SepaCharset.Extended) {
    return `${capitalize(theseCharacters(offending.length))} not in the EPC217-08 extended character set. Convert the value with toSepaCharset(value, { charset: 'extended' }) to keep local-language characters, or with toSepaCharset(value) for basic Latin.`
  }
  const outsideExtended = offending.filter(
    (character) => !isCharacterIn(character, SepaCharset.Extended)
  )
  if (outsideExtended.length === 0) {
    return `By default only the basic Latin set is allowed (${BASIC_SET_DESCRIPTION}). If your bank accepts the EPC217-08 extended character set, pass { charset: 'extended' } (SepaCharset.Extended); otherwise convert the value with toSepaCharset(value).`
  }
  const notExtended =
    outsideExtended.length === offending.length
      ? theseCharacters(offending.length)
      : `${describeOffending(outsideExtended)} ${outsideExtended.length === 1 ? 'is' : 'are'}`
  return `Only the basic Latin set is allowed (${BASIC_SET_DESCRIPTION}), and ${notExtended} not in the EPC217-08 extended set either. Convert the value with toSepaCharset(value).`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The validation message for a human-readable text field (names, addresses, remittance
 * information) whose value has characters outside the charset in force.
 */
export function textCharsetMessage(value: string, charset: SepaCharset): string {
  const offending = offendingCharacters(value, charset)
  const head = `${CHARSET_MESSAGE_PREFIX}: ${describeOffending(offending)}.`
  return `${head} ${textFieldAdvice(offending, charset)}${combiningMarkHint(offending)}`
}

/**
 * The validation message for an identifier, reference or code field, which must use
 * the basic Latin set in every charset mode (EPC217-08 section 6.3).
 */
export function referenceCharsetMessage(value: string): string {
  const offending = offendingCharacters(value, SepaCharset.Basic)
  const head = `${CHARSET_MESSAGE_PREFIX}: ${describeOffending(offending)}.`
  return `${head} Identifiers, references and codes must use the basic Latin set (${BASIC_SET_DESCRIPTION}) in every charset mode (EPC217-08 section 6.3). Convert the value with toSepaCharset(value).${combiningMarkHint(offending)}`
}

function convertCharacter(character: string, charset: SepaCharset): string {
  if (isCharacterIn(character, charset)) {
    return character
  }
  return (
    SECTION_6_2_SENDER_FALLBACKS.get(character) ?? EPC217_08_TO_BASIC.get(character) ?? FULL_STOP
  )
}

/**
 * Convert text to a SEPA character set using the official EPC217-08 conversion table.
 *
 * - The value is first normalized to NFC, so decomposed letters (S + combining caron)
 *   become one character (Š).
 * - Characters already in the target set are kept.
 * - The EPC217-08 section 6.2 sender rules apply first: & becomes +, @ becomes (at),
 *   € becomes E, _ becomes -.
 * - Other characters use the table's basic conversion (Š to S, ß to s, Ж to ZH, Щ to SHT).
 * - Anything the table cannot convert becomes a full stop (.), as EPC217-08 prescribes.
 *
 * Nothing is dropped, trimmed or truncated. The result can be longer than the input
 * (Щ becomes SHT), so a field can exceed its maximum length after conversion; the
 * validation error then says so.
 *
 * @param value the text to convert
 * @param options `charset`: the target set, 'basic' (default) or 'extended'. The
 *   extended target keeps local-language characters and only replaces characters
 *   outside the EPC217-08 extended set.
 * @returns the converted text, containing only characters of the target set
 * @throws Error if `charset` is not 'basic' or 'extended'
 *
 * @example
 * toSepaCharset('Maja Štupica') // 'Maja Stupica'
 * toSepaCharset('Müller & Söhne') // 'Muller + Sohne'
 * toSepaCharset('Maja Štupica 🎉', { charset: 'extended' }) // 'Maja Štupica .'
 */
export function toSepaCharset(value: string, options?: { charset?: SepaCharset }): string {
  const charset = resolveSepaCharset(options?.charset, SepaCharset.Basic)
  let result = ''
  for (const character of value.normalize('NFC')) {
    result += convertCharacter(character, charset)
  }
  return result
}

/**
 * XML character escaping, applied by the writer to every string value.
 * Escapes & < > " '
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
