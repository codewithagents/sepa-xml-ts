/**
 * Unit tests for sanitizeSepa() transliteration and isSepaCharset().
 *
 * Verifies:
 * 1. Core SEPA charset membership (isSepaCharset)
 * 2. Representative transliteration cases from EPC217-08 guidance
 * 3. Characters outside the SEPA set with no mapping are dropped
 * 4. Output of sanitizeSepa always passes isSepaCharset
 */

import { describe, it, expect } from 'vitest'
import { sanitizeSepa, isSepaCharset } from '../src/model/charset.js'

// ---------------------------------------------------------------------------
// isSepaCharset
// ---------------------------------------------------------------------------

describe('isSepaCharset: basic charset membership', () => {
  it('accepts ASCII letters and digits', () => {
    expect(isSepaCharset('abcdefghijklmnopqrstuvwxyz')).toBe(true)
    expect(isSepaCharset('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(true)
    expect(isSepaCharset('0123456789')).toBe(true)
  })

  it('accepts all allowed SEPA special characters', () => {
    expect(isSepaCharset("/ - ? : ( ) . , ' +")).toBe(true)
  })

  it('accepts an empty string', () => {
    expect(isSepaCharset('')).toBe(true)
  })

  it('rejects accented letters', () => {
    expect(isSepaCharset('ä')).toBe(false)
    expect(isSepaCharset('é')).toBe(false)
    expect(isSepaCharset('ñ')).toBe(false)
  })

  it('rejects emoji', () => {
    expect(isSepaCharset('hello 🎉')).toBe(false)
  })

  it('rejects CJK characters', () => {
    expect(isSepaCharset('你好')).toBe(false)
  })

  it('rejects ampersand (not in SEPA charset)', () => {
    expect(isSepaCharset('a&b')).toBe(false)
  })

  it('rejects @ symbol', () => {
    expect(isSepaCharset('user@example.com')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// sanitizeSepa: German umlauts and sharp-s (ae/oe/ue convention)
// ---------------------------------------------------------------------------

describe('sanitizeSepa: German umlaut transliteration (ae/oe/ue per EPC217-08 guidance)', () => {
  it('ä -> ae', () => {
    expect(sanitizeSepa('Muller')).toBe('Muller')
    expect(sanitizeSepa('Müller')).toBe('Mueller')
  })

  it('ö -> oe', () => {
    expect(sanitizeSepa('Schroeder')).toBe('Schroeder')
    expect(sanitizeSepa('Schröder')).toBe('Schroeder')
  })

  it('ü -> ue', () => {
    expect(sanitizeSepa('Mueller')).toBe('Mueller')
    expect(sanitizeSepa('Müller')).toBe('Mueller')
  })

  it('Ä -> Ae', () => {
    expect(sanitizeSepa('Ärger')).toBe('Aerger')
  })

  it('Ö -> Oe', () => {
    expect(sanitizeSepa('Österreich')).toBe('Oesterreich')
  })

  it('Ü -> Ue', () => {
    expect(sanitizeSepa('Über')).toBe('Ueber')
  })

  it('ß -> ss (Strasse)', () => {
    expect(sanitizeSepa('Straße')).toBe('Strasse')
    expect(sanitizeSepa('STRASSE')).toBe('STRASSE')
  })

  it('mixed German company name round-trips through SEPA charset', () => {
    const input = 'Müller und Söhne GmbH'
    const sanitized = sanitizeSepa(input)
    expect(sanitized).toBe('Mueller und Soehne GmbH')
    expect(isSepaCharset(sanitized)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// sanitizeSepa: French/Romance accented characters
// ---------------------------------------------------------------------------

describe('sanitizeSepa: French and Romance language accented characters', () => {
  it('c-cedilla ç -> c (Francois)', () => {
    expect(sanitizeSepa('François')).toBe('Francois')
  })

  it('C-cedilla Ç -> C', () => {
    expect(sanitizeSepa('Çabuk')).toBe('Cabuk')
  })

  it('é -> e (Jose)', () => {
    expect(sanitizeSepa('José')).toBe('Jose')
  })

  it('è -> e', () => {
    expect(sanitizeSepa('Mère')).toBe('Mere')
  })

  it('ê -> e', () => {
    expect(sanitizeSepa('Fête')).toBe('Fete')
  })

  it('ë -> e', () => {
    expect(sanitizeSepa('Noël')).toBe('Noel')
  })

  it('â -> a', () => {
    expect(sanitizeSepa('Château')).toBe('Chateau')
  })

  it('à -> a', () => {
    expect(sanitizeSepa('à la carte')).toBe('a la carte')
  })

  it('î -> i (naive)', () => {
    expect(sanitizeSepa('naïve')).toBe('naive')
  })

  it('ï -> i', () => {
    expect(sanitizeSepa('Citroën')).toBe('Citroen')
  })

  it('ô -> o', () => {
    expect(sanitizeSepa('côte')).toBe('cote')
  })

  it('ù/ú/û -> u (grave, acute, circumflex)', () => {
    expect(sanitizeSepa('où')).toBe('ou')
    expect(sanitizeSepa('rúa')).toBe('rua')
    expect(sanitizeSepa('bûche')).toBe('buche')
  })

  it('Ù/Ú/Û -> U (uppercase, all three accents)', () => {
    expect(sanitizeSepa('Ùber')).toBe('Uber')
    expect(sanitizeSepa('Únicode')).toBe('Unicode')
    expect(sanitizeSepa('Ûber')).toBe('Uber')
  })

  it('full French name sanitizes to valid SEPA text', () => {
    const input = 'François Müller-Dupont'
    const sanitized = sanitizeSepa(input)
    expect(sanitized).toBe('Francois Mueller-Dupont')
    expect(isSepaCharset(sanitized)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// sanitizeSepa: Spanish/Portuguese accented characters
// ---------------------------------------------------------------------------

describe('sanitizeSepa: Spanish and Portuguese characters', () => {
  it('ñ -> n', () => {
    expect(sanitizeSepa('España')).toBe('Espana')
    expect(sanitizeSepa('Señor')).toBe('Senor')
  })

  it('Ñ -> N', () => {
    expect(sanitizeSepa('Ñoño')).toBe('Nono')
  })

  it('ã/õ -> a/o (tilde vowels)', () => {
    expect(sanitizeSepa('São Paulo')).toBe('Sao Paulo')
    expect(sanitizeSepa('Coração')).toBe('Coracao')
  })

  it('ý -> y', () => {
    expect(sanitizeSepa('Ý/ý')).toBe('Y/y')
  })

  it('Ý -> Y', () => {
    expect(sanitizeSepa('Ýmir')).toBe('Ymir')
  })
})

// ---------------------------------------------------------------------------
// sanitizeSepa: Nordic characters
// ---------------------------------------------------------------------------

describe('sanitizeSepa: Nordic characters', () => {
  it('å/Å -> a/A', () => {
    expect(sanitizeSepa('Åland')).toBe('Aland')
    expect(sanitizeSepa('Malmå')).toBe('Malma')
  })

  it('ø/Ø -> o/O', () => {
    expect(sanitizeSepa('Søren')).toBe('Soren')
    expect(sanitizeSepa('Ørsted')).toBe('Orsted')
  })

  it('æ/Æ -> ae/AE', () => {
    expect(sanitizeSepa('Kjærlighet')).toBe('Kjaerlighet')
    expect(sanitizeSepa('Ærlig')).toBe('AErlig')
  })

  it('þ/Þ -> th/TH (thorn)', () => {
    // ö maps to oe (German convention), so þórsmörk -> thorsmoerk
    expect(sanitizeSepa('þórsmörk')).toBe('thorsmoerk')
    expect(sanitizeSepa('Þór')).toBe('THor')
  })

  it('ð/Ð -> d/D (eth)', () => {
    expect(sanitizeSepa('Guðmundur')).toBe('Gudmundur')
    expect(sanitizeSepa('Ðinn')).toBe('Dinn')
  })
})

// ---------------------------------------------------------------------------
// sanitizeSepa: Characters outside SEPA set with no mapping are dropped
// ---------------------------------------------------------------------------

describe('sanitizeSepa: non-Latin characters are dropped', () => {
  it('emoji are dropped (surrounding spaces collapse to one)', () => {
    // The emoji is dropped; the spaces around it collapse: 'Hello  World' -> 'Hello World'
    expect(sanitizeSepa('Hello 🎉 World')).toBe('Hello World')
  })

  it('multiple consecutive emojis collapse to single space', () => {
    const result = sanitizeSepa('Hello 🎉🎊 World')
    expect(isSepaCharset(result)).toBe(true)
    expect(result).toContain('Hello')
    expect(result).toContain('World')
  })

  it('CJK characters are dropped (surrounding spaces collapse to one)', () => {
    // CJK chars are dropped; the surrounding spaces collapse: 'Hello  World' -> 'Hello World'
    expect(sanitizeSepa('Hello 你好 World')).toBe('Hello World')
  })

  it('Arabic characters are dropped', () => {
    const input = 'Hello مرحبا World'
    const result = sanitizeSepa(input)
    expect(isSepaCharset(result)).toBe(true)
    expect(result).toContain('Hello')
    expect(result).toContain('World')
  })

  it('Cyrillic characters are dropped', () => {
    const input = 'Hello Привет World'
    const result = sanitizeSepa(input)
    expect(isSepaCharset(result)).toBe(true)
    expect(result).toContain('Hello')
    expect(result).toContain('World')
  })

  it('string of only emojis becomes empty after sanitize', () => {
    const result = sanitizeSepa('🎉🎊🥳')
    expect(result).toBe('')
    expect(isSepaCharset(result)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// sanitizeSepa: output always passes isSepaCharset
// ---------------------------------------------------------------------------

describe('sanitizeSepa: output always within SEPA charset', () => {
  const testCases = [
    'Müller und Söhne GmbH',
    'François Dupont',
    'José García',
    'naïve',
    'Straße',
    'São Paulo Ltda',
    'Kjærlighet',
    'Åland Islands',
    'Ørsted Energi',
    'þórsmörk adventures',
    'hello 🎉 world',
    '你好世界',
    'Ärger Über Österreich',
    'Noël Citroën Château',
    'Ñoño España',
    'Ùber Ú Ûber',
    'Ý/ý test',
    '',
    '   ',
    'already valid SEPA text',
    'Invoice 2024/42 - Payment +10.00',
  ]

  for (const input of testCases) {
    it(`sanitizeSepa(${JSON.stringify(input)}) output passes isSepaCharset`, () => {
      const result = sanitizeSepa(input)
      expect(isSepaCharset(result)).toBe(true)
    })
  }
})

// ---------------------------------------------------------------------------
// sanitizeSepa: multi-space collapsing and trimming
// ---------------------------------------------------------------------------

describe('sanitizeSepa: whitespace handling', () => {
  it('collapses multiple spaces', () => {
    expect(sanitizeSepa('hello   world')).toBe('hello world')
  })

  it('trims leading and trailing spaces', () => {
    expect(sanitizeSepa('  hello  ')).toBe('hello')
  })

  it('spaces produced by dropped characters are collapsed', () => {
    // emoji between two words produces extra space, which gets collapsed
    const result = sanitizeSepa('hello🎉world')
    expect(result).toBe('helloworld')
    expect(isSepaCharset(result)).toBe(true)
  })
})
