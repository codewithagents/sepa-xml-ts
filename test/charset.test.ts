/**
 * toSepaCharset and the charset predicates, checked against literal expectations
 * written from EPC217-08 (an oracle independent of the table fixture), plus properties
 * over arbitrary Unicode input. The every-entry check lives in epc217-08-table.test.ts.
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  SepaCharset,
  toSepaCharset,
  isSepaBasic,
  isInSepaCharset,
  offendingCharacters,
  resolveSepaCharset,
  textCharsetMessage,
  referenceCharsetMessage,
} from '../src/model/charset.js'
import * as publicApi from '../src/index.js'

const NBSP = '\u00A0'

describe('SepaCharset', () => {
  it('should name the two EPC217-08 character sets', () => {
    expect(SepaCharset).toEqual({ Basic: 'basic', Extended: 'extended' })
  })

  it('should export SepaCharset and toSepaCharset from the package root, and no charset internals', () => {
    expect(publicApi.SepaCharset).toBe(SepaCharset)
    expect(publicApi.toSepaCharset).toBe(toSepaCharset)
    for (const internal of ['isSepaBasic', 'isInSepaCharset', 'offendingCharacters', 'escapeXml']) {
      expect(Object.keys(publicApi)).not.toContain(internal)
    }
  })
})

describe('isSepaBasic: basic Latin membership', () => {
  it('should accept ASCII letters, digits and the basic punctuation including the apostrophe', () => {
    expect(isSepaBasic('abcdefghijklmnopqrstuvwxyz')).toBe(true)
    expect(isSepaBasic('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(true)
    expect(isSepaBasic('0123456789')).toBe(true)
    expect(isSepaBasic("/ - ? : ( ) . , ' +")).toBe(true)
  })

  it('should accept an empty string', () => {
    expect(isSepaBasic('')).toBe(true)
  })

  it('should reject accented letters, &, @, emoji, CJK and the no-break space', () => {
    for (const value of ['ä', 'Š', 'a&b', 'user@example.com', 'hello 🎉', '你好', `a${NBSP}b`]) {
      expect(isSepaBasic(value), value).toBe(false)
    }
  })
})

describe('isInSepaCharset and offendingCharacters', () => {
  it('should accept local-language and special characters in the extended set only', () => {
    for (const value of [
      'Maja Štupica',
      'Plačilo računa čšž',
      'Müller & Söhne',
      'Жеков',
      '€ 50',
      'info@firma.si',
    ]) {
      expect(isInSepaCharset(value, 'extended'), value).toBe(true)
      expect(isInSepaCharset(value, 'basic'), value).toBe(false)
    }
  })

  it('should reject characters outside the extended set in both sets', () => {
    for (const value of ['🎉', '你好', 'O\u2019Brien', 'S\u030Ctupica', '±', 'Ġ', '\t']) {
      expect(isInSepaCharset(value, 'extended'), value).toBe(false)
      expect(isInSepaCharset(value, 'basic'), value).toBe(false)
    }
  })

  it('should list distinct offending characters in order of first occurrence', () => {
    expect(offendingCharacters('Štupica Šuštar čžŠ', 'basic')).toEqual(['Š', 'š', 'č', 'ž'])
    expect(offendingCharacters('Maja Štupica 🎉🎉', 'extended')).toEqual(['🎉'])
    expect(offendingCharacters('plain text', 'basic')).toEqual([])
  })

  it('should treat an emoji (a surrogate pair) and a lone surrogate as one character each', () => {
    expect(offendingCharacters('a😀b\uD800c', 'basic')).toEqual(['😀', '\uD800'])
  })
})

describe('resolveSepaCharset', () => {
  it('should use the default when the option is absent and accept both sets', () => {
    expect(resolveSepaCharset(undefined, 'basic')).toBe('basic')
    expect(resolveSepaCharset(undefined, 'extended')).toBe('extended')
    expect(resolveSepaCharset('extended', 'basic')).toBe('extended')
    expect(resolveSepaCharset(SepaCharset.Basic, 'extended')).toBe('basic')
  })

  it('should throw a clear error for an unknown value', () => {
    expect(() => resolveSepaCharset('latin1', 'basic')).toThrow(
      `Unknown charset "latin1": expected 'basic' or 'extended' (SepaCharset.Basic, SepaCharset.Extended)`
    )
    expect(() => resolveSepaCharset('Extended', 'basic')).toThrow(/Unknown charset "Extended"/)
  })
})

describe('toSepaCharset: literal EPC217-08 expectations (basic target)', () => {
  const cases: Array<[string, string]> = [
    ['Š', 'S'],
    ['č', 'c'],
    ['ž', 'z'],
    ['ä', 'a'],
    ['Ä', 'A'],
    ['ß', 's'],
    ['æ', 'a'],
    ['Ж', 'ZH'],
    ['Щ', 'SHT'],
    ['Θ', 'TH'],
    ['€', 'E'],
    ['&', '+'],
    ['@', '(at)'],
    ['_', '-'],
    ['"', '.'],
    ['<', '.'],
    ['>', '.'],
    [';', ','],
    ['`', "'"],
    ['[', '('],
    [']', ')'],
    [NBSP, ' '],
    ['\u2019', '.'],
    ['\u{1F600}', '.'],
    ['\u0009', '.'],
    ['\uD800', '.'],
    ['\u0460', '.'],
    ['\u20AB', '.'],
    ['\u20AD', '.'],
    ['Þ', 'TH'],
    ['þ', 'th'],
    ['Ð', 'D'],
    ['ð', 'd'],
    ['', ''],
  ]

  for (const [input, expected] of cases) {
    it(`should convert ${JSON.stringify(input)} to ${JSON.stringify(expected)}`, () => {
      expect(toSepaCharset(input)).toBe(expected)
    })
  }

  it('should convert one emoji (a surrogate pair) to exactly one full stop', () => {
    expect(toSepaCharset('a\u{1F600}b')).toBe('a.b')
  })

  it('should compose decomposed text (NFD) before converting', () => {
    expect(toSepaCharset('S\u030Ctupica')).toBe('Stupica')
  })

  it('should convert the documented examples', () => {
    expect(toSepaCharset('Maja Štupica')).toBe('Maja Stupica')
    expect(toSepaCharset('Müller & Söhne')).toBe('Muller + Sohne')
    expect(toSepaCharset('info@firma.si')).toBe('info(at)firma.si')
    expect(toSepaCharset('Жеков Щ')).toBe('ZHekov SHT')
    expect(toSepaCharset('O\u2019Brien')).toBe('O.Brien')
    expect(toSepaCharset('€ 50')).toBe('E 50')
    expect(toSepaCharset(`a${NBSP}b`)).toBe('a b')
    expect(toSepaCharset('Þór')).toBe('THor')
  })

  it('should not use the German ae/oe/ue/ss convention (EPC converts one to one)', () => {
    expect(toSepaCharset('Müller Straße Österreich')).toBe('Muller Strase Osterreich')
  })

  it('should not drop, trim or collapse anything', () => {
    expect(toSepaCharset('  Hello 🎉🎊  World  ')).toBe('  Hello ..  World  ')
    expect(toSepaCharset('你好')).toBe('..')
  })
})

describe('toSepaCharset: extended target', () => {
  it('should keep local-language characters and replace only characters outside the extended set', () => {
    expect(toSepaCharset('Maja Štupica 🎉', { charset: 'extended' })).toBe('Maja Štupica .')
    expect(toSepaCharset('Müller & Söhne', { charset: SepaCharset.Extended })).toBe(
      'Müller & Söhne'
    )
    expect(toSepaCharset('info@firma.si', { charset: 'extended' })).toBe('info@firma.si')
    expect(toSepaCharset(`a${NBSP}b`, { charset: 'extended' })).toBe(`a${NBSP}b`)
  })

  it('should compose decomposed text (NFD) into the precomposed extended letter', () => {
    expect(toSepaCharset('S\u030Ctupica', { charset: 'extended' })).toBe('Štupica')
  })

  it('should convert red letters with a table conversion, and the rest to a full stop', () => {
    expect(toSepaCharset('Ġ ħ ±', { charset: 'extended' })).toBe('G h .')
  })

  it('should throw for an unknown target charset', () => {
    expect(() => toSepaCharset('x', { charset: 'latin1' as never })).toThrow(
      /Unknown charset "latin1"/
    )
  })
})

describe('toSepaCharset: properties over arbitrary Unicode', () => {
  const arbUnicode = fc.oneof(
    fc.string({ unit: 'binary', maxLength: 40 }),
    fc.string({
      unit: fc.constantFrom(...[...'aŠčžäßЖЩΘ€&@_"<>;`\u00A0\u2019\u030C🎉 ']),
      maxLength: 40,
    })
  )
  const targets: Array<'basic' | 'extended'> = ['basic', 'extended']

  for (const charset of targets) {
    it(`should always produce text in the ${charset} set (numRuns=300)`, () => {
      fc.assert(
        fc.property(arbUnicode, (value) =>
          isInSepaCharset(toSepaCharset(value, { charset }), charset)
        ),
        { numRuns: 300 }
      )
    })

    it(`should be idempotent for the ${charset} target (numRuns=300)`, () => {
      fc.assert(
        fc.property(arbUnicode, (value) => {
          const once = toSepaCharset(value, { charset })
          return toSepaCharset(once, { charset }) === once
        }),
        { numRuns: 300 }
      )
    })

    it(`should never shorten the NFC input in code points for the ${charset} target (numRuns=300)`, () => {
      fc.assert(
        fc.property(arbUnicode, (value) => {
          const input = [...value.normalize('NFC')].length
          return [...toSepaCharset(value, { charset })].length >= input
        }),
        { numRuns: 300 }
      )
    })

    it(`should give canonically equivalent input the same output for the ${charset} target (numRuns=300)`, () => {
      fc.assert(
        fc.property(arbUnicode, (value) => {
          const output = toSepaCharset(value, { charset })
          return (
            toSepaCharset(value.normalize('NFD'), { charset }) === output &&
            toSepaCharset(value.normalize('NFC'), { charset }) === output
          )
        }),
        { numRuns: 300 }
      )
    })
  }

  it('should be the identity on NFC text already in the target set (numRuns=300)', () => {
    fc.assert(
      fc.property(arbUnicode, (value) => {
        const nfc = value.normalize('NFC')
        for (const charset of targets) {
          if (isInSepaCharset(nfc, charset) && toSepaCharset(nfc, { charset }) !== nfc) return false
        }
        return true
      }),
      { numRuns: 300 }
    )
  })
})

describe('charset validation messages', () => {
  const PREFIX = 'Value contains characters outside the SEPA charset (EPC217-08): '

  it('should name each offending character with its code point, keeping the stable prefix', () => {
    expect(referenceCharsetMessage('MND-\u017D')).toBe(
      `${PREFIX}"\u017D" (U+017D). Identifiers, references and codes must use the basic Latin set (a-z A-Z 0-9 space / - ? : ( ) . , ' +) in every charset mode (EPC217-08 section 6.3). Convert the value with toSepaCharset(value).`
    )
  })

  it('should list at most 5 characters and count the rest', () => {
    expect(referenceCharsetMessage('\u00C4\u00D6\u00DC\u00E4\u00F6\u00FC\u00DF')).toContain(
      '"\u00C4" (U+00C4), "\u00D6" (U+00D6), "\u00DC" (U+00DC), "\u00E4" (U+00E4), "\u00F6" (U+00F6), and 2 more.'
    )
  })

  it('should show code points above U+FFFF in full', () => {
    expect(textCharsetMessage('Party \u{1F600}', 'basic')).toContain('"\u{1F600}" (U+1F600)')
  })

  it('should add a normalization hint when the value contains combining marks', () => {
    const message = textCharsetMessage('S\u030Ctupica', 'basic')
    expect(message).toContain('"\u030C" (U+030C)')
    expect(message).toContain(
      "The value contains combining marks (decomposed text): normalize it with value.normalize('NFC'); toSepaCharset does this for you."
    )
    expect(textCharsetMessage('\u0160tupica', 'basic')).not.toContain('combining marks')
  })
})
