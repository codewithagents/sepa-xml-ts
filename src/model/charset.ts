/**
 * SEPA character set as defined by EPC217-08.
 * Allowed characters: a-z A-Z 0-9, space, and / - ? : ( ) . , ' +
 * Extended Latin characters should be transliterated or removed.
 */

const SEPA_ALLOWED = /^[a-zA-Z0-9 /\-?:().,'+]*$/

/**
 * Returns true if the string contains only SEPA-allowed characters.
 * An empty string is allowed (callers enforce min-length separately).
 */
export function isSepaCharset(value: string): boolean {
  return SEPA_ALLOWED.test(value)
}

/**
 * Transliteration table for extended Latin characters to the SEPA basic character set.
 *
 * Mapping source: EPC217-08 "Guidance on the Use of the SEPA Basic Character Set"
 * and the de-facto best practices followed by major European banks.
 *
 * Conventions applied:
 * - German umlauts: ae/oe/ue (Ä -> Ae, Ö -> Oe, Ü -> Ue; lowercase ae/oe/ue)
 * - German sharp-s: ss (ß -> ss)
 * - All other accented/modified Latin letters: map to the unaccented base letter
 * - Ligatures: ae (Æ/æ -> AE/ae)
 * - Nordic eth (Ð/ð) -> D/d; thorn (Þ/þ) -> TH/th
 * - Characters with no mapping are silently dropped by sanitizeSepa
 *
 * Complete coverage of Latin-1 Supplement (U+00C0-U+00FF) except × and ÷ (operators).
 */
const TRANSLITERATION_MAP: Record<string, string> = {
  // German umlauts and sharp-s (ae/oe/ue convention per EPC217-08 guidance)
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
  ß: 'ss',
  // Accented A (grave, acute, circumflex, tilde, ring) -> base letter
  à: 'a',
  á: 'a',
  â: 'a',
  ã: 'a',
  å: 'a',
  À: 'A',
  Á: 'A',
  Â: 'A',
  Ã: 'A',
  Å: 'A',
  // AE ligature
  æ: 'ae',
  Æ: 'AE',
  // C-cedilla
  ç: 'c',
  Ç: 'C',
  // Accented E (grave, acute, circumflex, diaeresis) -> base letter
  è: 'e',
  é: 'e',
  ê: 'e',
  ë: 'e',
  È: 'E',
  É: 'E',
  Ê: 'E',
  Ë: 'E',
  // Accented I (grave, acute, circumflex, diaeresis) -> base letter
  ì: 'i',
  í: 'i',
  î: 'i',
  ï: 'i',
  Ì: 'I',
  Í: 'I',
  Î: 'I',
  Ï: 'I',
  // Eth (Icelandic/Old English) -> D/d
  ð: 'd',
  Ð: 'D',
  // N-tilde -> base letter
  ñ: 'n',
  Ñ: 'N',
  // Accented O (grave, acute, circumflex, tilde, stroke) -> base letter
  ò: 'o',
  ó: 'o',
  ô: 'o',
  õ: 'o',
  ø: 'o',
  Ò: 'O',
  Ó: 'O',
  Ô: 'O',
  Õ: 'O',
  Ø: 'O',
  // Accented U (grave, acute, circumflex) -> base letter; U-umlaut uses ue convention above
  ù: 'u',
  ú: 'u',
  û: 'u',
  Ù: 'U',
  Ú: 'U',
  Û: 'U',
  // Accented Y -> base letter
  ý: 'y',
  ÿ: 'y',
  Ý: 'Y',
  // Thorn (Old English/Icelandic) -> TH/th
  þ: 'th',
  Þ: 'TH',
}

/**
 * Sanitize a string to SEPA charset.
 * Transliterates known extended Latin characters; removes anything else outside the allowed set.
 * Collapses multiple spaces and trims leading/trailing spaces.
 */
export function sanitizeSepa(value: string): string {
  let result = ''
  for (const ch of value) {
    if (SEPA_ALLOWED.test(ch)) {
      result += ch
    } else {
      const mapped = TRANSLITERATION_MAP[ch]
      if (mapped !== undefined) {
        result += mapped
      }
      // else: silently drop the character
    }
  }
  // Collapse multiple spaces, trim
  return result.replace(/ {2,}/g, ' ').trim()
}

/**
 * XML character escaping on top of SEPA charset.
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
