/**
 * SEPA character set as defined by EPC217-08.
 * Allowed characters: a-z A-Z 0-9, space, and / - ? : ( ) . , ' +
 * Extended Latin characters should be transliterated or removed.
 */

const SEPA_ALLOWED = /^[a-zA-Z0-9 /\-?:().,'+]*$/;

/**
 * Returns true if the string contains only SEPA-allowed characters.
 * An empty string is allowed (callers enforce min-length separately).
 */
export function isSepaCharset(value: string): boolean {
  return SEPA_ALLOWED.test(value);
}

/** Transliteration table for common extended Latin characters to ASCII equivalents. */
const TRANSLITERATION_MAP: Record<string, string> = {
  // German
  "ä": "ae",
  "ö": "oe",
  "ü": "ue",
  "Ä": "Ae",
  "Ö": "Oe",
  "Ü": "Ue",
  "ß": "ss",
  // French / other accented
  "à": "a",
  "á": "a",
  "â": "a",
  "ã": "a",
  "å": "a",
  "æ": "ae",
  "ç": "c",
  "è": "e",
  "é": "e",
  "ê": "e",
  "ë": "e",
  "ì": "i",
  "í": "i",
  "î": "i",
  "ï": "i",
  "ð": "d",
  "ñ": "n",
  "ò": "o",
  "ó": "o",
  "ô": "o",
  "õ": "o",
  "ø": "o",
  "ù": "u",
  "ú": "u",
  "û": "u",
  "ý": "y",
  "ÿ": "y",
  "À": "A",
  "Á": "A",
  "Â": "A",
  "Ã": "A",
  "Å": "A",
  "Æ": "AE",
  "Ç": "C",
  "È": "E",
  "É": "E",
  "Ê": "E",
  "Ë": "E",
  "Ì": "I",
  "Í": "I",
  "Î": "I",
  "Ï": "I",
  "Ð": "D",
  "Ñ": "N",
  "Ò": "O",
  "Ó": "O",
  "Ô": "O",
  "Õ": "O",
  "Ø": "O",
  "Ù": "U",
  "Ú": "U",
  "Û": "U",
  "Ý": "Y",
  // Nordic
  "þ": "th",
  "Þ": "TH",
};

/**
 * Sanitize a string to SEPA charset.
 * Transliterates known extended Latin characters; removes anything else outside the allowed set.
 * Collapses multiple spaces and trims leading/trailing spaces.
 */
export function sanitizeSepa(value: string): string {
  let result = "";
  for (const ch of value) {
    if (SEPA_ALLOWED.test(ch)) {
      result += ch;
    } else {
      const mapped = TRANSLITERATION_MAP[ch];
      if (mapped !== undefined) {
        result += mapped;
      }
      // else: silently drop the character
    }
  }
  // Collapse multiple spaces, trim
  return result.replace(/ {2,}/g, " ").trim();
}

/**
 * XML character escaping on top of SEPA charset.
 * Escapes & < > " '
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
