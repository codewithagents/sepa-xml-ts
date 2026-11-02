/**
 * The EPC217-08 SEPA conversion table: fixture integrity, the generated module, and
 * every table entry through toSepaCharset for both targets.
 *
 * The fixture (test/fixtures/epc217-08/conversion-table.json, see NOTICE.md there) is
 * the source of truth. src/model/epc217-08-table.ts is generated from it; this test
 * fails when the two drift. To regenerate after an intentional fixture change:
 *   UPDATE_EPC217_08_TABLE=true pnpm vitest run test/epc217-08-table.test.ts
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'
import {
  EPC217_08_SOURCE,
  EPC217_08_EXTENDED_ONLY,
  EPC217_08_TO_BASIC,
} from '../src/model/epc217-08-table.js'
import { toSepaCharset, isSepaBasic, isInSepaCharset } from '../src/model/charset.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = join(__dirname, 'fixtures/epc217-08/conversion-table.json')
const MODULE_PATH = join(__dirname, '../src/model/epc217-08-table.ts')

type TableSet = 'basic' | 'extended' | 'outside'

interface TableEntry {
  codePoint: string
  char: string
  name: string
  set: TableSet
  basic: string | null
  basicCodePoints: string[] | null
  extended: string | null
  extendedCodePoints: string[] | null
}

interface TableRange {
  from: string
  to: string
  set: TableSet
  basic: string
  extended: string
}

interface ConversionTable {
  source: { document: string; file: string; url: string; sha256: string; companion: string }
  entries: TableEntry[]
  ranges: TableRange[]
}

const TABLE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as ConversionTable

const APOSTROPHE = "'"

/**
 * The table's Sign column (D) and its code-point column (E) disagree in these rows.
 * Column E is mistyped (Þ -> U+0062 'b', ĥ -> U+0069 'i'); the Sign column wins.
 * Thorn is the deliberate exception: the table's note on Þ says "sender should send TH",
 * and this library is the sender.
 */
const SIGN_COLUMN_ERRATA: ReadonlyMap<string, string> = new Map([
  ['U+00D0', 'D'],
  ['U+00DE', 'TH'],
  ['U+00F0', 'd'],
  ['U+00FE', 'th'],
  ['U+0125', 'h'],
  ['U+0127', 'h'],
])

/**
 * Green entries this library does not accept in extended text. U+00A0 NO-BREAK SPACE:
 * the table's own extended conversion (columns F and G) turns it into a space, and the
 * parser trims element text with String.prototype.trim, which strips it, so it cannot
 * round-trip. toSepaCharset converts it to a space for both targets.
 */
const GREEN_NOT_ACCEPTED: ReadonlySet<string> = new Set(['U+00A0'])

/** EPC217-08 section 6.2: best practice for the sender, overriding the table. */
const SECTION_6_2: ReadonlyMap<string, string> = new Map([
  ['&', '+'],
  ['@', '(at)'],
  ['€', 'E'],
  ['_', '-'],
])

function isBasicEntry(entry: TableEntry): boolean {
  return entry.set === 'basic' || entry.char === APOSTROPHE
}

function isExtendedEntry(entry: TableEntry): boolean {
  return entry.set === 'extended' && !GREEN_NOT_ACCEPTED.has(entry.codePoint)
}

function tableBasicConversion(entry: TableEntry): string | null {
  return SIGN_COLUMN_ERRATA.get(entry.codePoint) ?? entry.basic
}

const ENTRY_BY_CHAR: ReadonlyMap<string, TableEntry> = new Map(
  TABLE.entries.map((entry) => [entry.char, entry])
)

/** The expected output for one character that is a table entry, from the documented rules. */
function expectedForCharacter(character: string, target: 'basic' | 'extended'): string {
  const entry = ENTRY_BY_CHAR.get(character)
  if (entry === undefined) return '.'
  if (isBasicEntry(entry)) return entry.char
  if (target === 'extended' && isExtendedEntry(entry)) return entry.char
  const conversion = SECTION_6_2.get(entry.char) ?? tableBasicConversion(entry)
  return conversion ?? '.'
}

/**
 * The expected output for a table entry. toSepaCharset normalizes to NFC first, so the
 * 7 red singleton entries whose NFC form is another code point (U+037E GREEK QUESTION
 * MARK is canonically ';') convert as their canonical equivalent.
 */
function expectedFor(entry: TableEntry, target: 'basic' | 'extended'): string {
  return [...entry.char.normalize('NFC')]
    .map((character) => expectedForCharacter(character, target))
    .join('')
}

function deriveExtendedOnly(): string[] {
  return TABLE.entries
    .filter((entry) => isExtendedEntry(entry) && !isBasicEntry(entry))
    .map((entry) => entry.char)
}

function deriveToBasic(): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (const entry of TABLE.entries) {
    if (isBasicEntry(entry)) continue
    const conversion = tableBasicConversion(entry)
    if (conversion !== null && conversion !== '.') pairs.push([entry.char, conversion])
  }
  return pairs
}

function codePointsToString(codePoints: string[]): string {
  return codePoints.map((cp) => String.fromCodePoint(Number.parseInt(cp.slice(2), 16))).join('')
}

function tsLiteral(value: string): string {
  const escaped = [...value]
    .map((ch) => {
      if (ch === '\\' || ch === "'") return `\\${ch}`
      if (ch !== ' ' && /[\p{C}\p{Z}\p{M}]/u.test(ch)) {
        return `\\u${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`
      }
      return ch
    })
    .join('')
  return `'${escaped}'`
}

async function generateModule(): Promise<string> {
  const { source } = TABLE
  const extendedOnly = deriveExtendedOnly()
    .map((ch) => `  ${tsLiteral(ch)},`)
    .join('\n')
  const toBasic = deriveToBasic()
    .map(([from, to]) => `  [${tsLiteral(from)}, ${tsLiteral(to)}],`)
    .join('\n')
  const text = `// Generated by test/epc217-08-table.test.ts from test/fixtures/epc217-08/conversion-table.json. Do not edit.

export const EPC217_08_SOURCE = {
  document: ${tsLiteral(source.document)},
  file: ${tsLiteral(source.file)},
  url: ${tsLiteral(source.url)},
  sha256: ${tsLiteral(source.sha256)},
} as const

export const EPC217_08_EXTENDED_ONLY: ReadonlySet<string> = new Set([
${extendedOnly}
])

export const EPC217_08_TO_BASIC: ReadonlyMap<string, string> = new Map([
${toBasic}
])
`
  const config = (await resolveConfig(MODULE_PATH)) ?? {}
  return format(text, { ...config, filepath: MODULE_PATH })
}

describe('EPC217-08 generated table module', () => {
  it('should equal the derivation from the fixture (regenerate with UPDATE_EPC217_08_TABLE=true)', async () => {
    if (process.env['UPDATE_EPC217_08_TABLE'] === 'true') {
      writeFileSync(MODULE_PATH, await generateModule(), 'utf-8')
      console.log('[UPDATE_EPC217_08_TABLE] wrote src/model/epc217-08-table.ts')
    }
    expect(readFileSync(MODULE_PATH, 'utf-8')).toBe(await generateModule())
    expect([...EPC217_08_EXTENDED_ONLY]).toEqual(deriveExtendedOnly())
    expect([...EPC217_08_TO_BASIC]).toEqual(deriveToBasic())
  })

  it('should record the provenance of the fixture', () => {
    expect(EPC217_08_SOURCE).toEqual({
      document: TABLE.source.document,
      file: TABLE.source.file,
      url: TABLE.source.url,
      sha256: TABLE.source.sha256,
    })
    expect(EPC217_08_SOURCE.sha256).toBe(
      '44d1bb47e3f47db6307e5db6828c73d29b31f2bc1a2d117303c04cdcb57be149'
    )
  })

  it('should hold the 314 green characters other than the apostrophe and the no-break space, and 327 conversions', () => {
    expect(EPC217_08_EXTENDED_ONLY.size).toBe(314)
    expect(EPC217_08_EXTENDED_ONLY.has('\u00A0')).toBe(false)
    expect(EPC217_08_TO_BASIC.size).toBe(327)
    expect(EPC217_08_TO_BASIC.get('\u00A0')).toBe(' ')
  })

  it('should leave out exactly the green entries the decisions name (NOTICE.md)', () => {
    const green = TABLE.entries.filter((entry) => entry.set === 'extended')
    const notAccepted = green.filter((entry) => !isExtendedEntry(entry))
    expect(notAccepted.map((entry) => [entry.codePoint, entry.name, entry.extended])).toEqual([
      ['U+00A0', 'NO-BREAK SPACE', ' '],
    ])
  })

  it('should convert only to basic Latin text', () => {
    for (const [from, to] of EPC217_08_TO_BASIC) {
      expect(isSepaBasic(to), `${from} -> ${to}`).toBe(true)
      expect(to.length).toBeGreaterThan(0)
    }
  })
})

describe('EPC217-08 fixture integrity', () => {
  it('should list every code point from U+0020 to U+045F plus the euro sign, once each', () => {
    const codePoints = TABLE.entries.map((entry) => Number.parseInt(entry.codePoint.slice(2), 16))
    const expected = [...Array.from({ length: 0x460 - 0x20 }, (_, i) => 0x20 + i), 0x20ac]
    expect(codePoints).toEqual(expected)
    expect(TABLE.entries).toHaveLength(1089)
  })

  it('should store each character as the code point it names', () => {
    for (const entry of TABLE.entries) {
      expect(entry.char, entry.codePoint).toBe(
        String.fromCodePoint(Number.parseInt(entry.codePoint.slice(2), 16))
      )
    }
  })

  it('should colour 72 entries yellow (basic), 316 green (extended) and 701 red (outside)', () => {
    const counts = { basic: 0, extended: 0, outside: 0 }
    for (const entry of TABLE.entries) counts[entry.set]++
    expect(counts).toEqual({ basic: 72, extended: 316, outside: 701 })
  })

  it('should colour exactly the EPC Implementation Guidelines basic Latin set yellow', () => {
    const yellow = TABLE.entries.filter((entry) => entry.set === 'basic').map((e) => e.char)
    const basicLatin = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /-?:().,+'
    expect(new Set(yellow)).toEqual(new Set(basicLatin))
  })

  it('should pin the Sign-column errata: column E disagrees with column D in exactly these 6 rows', () => {
    const disagreements = TABLE.entries
      .filter((entry) => entry.basic !== null && entry.basicCodePoints !== null)
      .filter((entry) => codePointsToString(entry.basicCodePoints ?? []) !== entry.basic)
      .map((entry) => [
        entry.codePoint,
        entry.char,
        entry.basic,
        codePointsToString(entry.basicCodePoints ?? []),
      ])
    expect(disagreements).toEqual([
      ['U+00D0', 'Ð', 'D', '.'],
      ['U+00DE', 'Þ', 'T', 'b'],
      ['U+00F0', 'ð', 'd', '.'],
      ['U+00FE', 'þ', 't', 'p'],
      ['U+0125', 'ĥ', 'h', 'i'],
      ['U+0127', 'ħ', 'h', 'i'],
    ])
  })

  it('should resolve the 6 erratum rows from the Sign column, with TH for thorn', () => {
    expect(toSepaCharset('Ð')).toBe('D')
    expect(toSepaCharset('ð')).toBe('d')
    expect(toSepaCharset('Þ')).toBe('TH')
    expect(toSepaCharset('þ')).toBe('th')
    expect(toSepaCharset('ĥ')).toBe('h')
    expect(toSepaCharset('ħ')).toBe('h')
  })

  it('should give the same conversion for both targets on every red entry', () => {
    for (const entry of TABLE.entries.filter((e) => e.set === 'outside')) {
      expect(entry.extended, entry.codePoint).toBe(entry.basic)
    }
  })

  it('should cover the rest of Unicode with two red range rows that convert to a full stop', () => {
    expect(TABLE.ranges).toEqual([
      expect.objectContaining({ from: 'U+0460', to: 'U+20AB', set: 'outside', basic: '.' }),
      expect.objectContaining({ from: 'U+20AD', to: 'U+10FFFF', set: 'outside', basic: '.' }),
    ])
  })
})

describe('toSepaCharset over every EPC217-08 table entry', () => {
  it('should put each entry in the right set (apostrophe counts as basic, no-break space as neither)', () => {
    for (const entry of TABLE.entries) {
      expect(isSepaBasic(entry.char), entry.codePoint).toBe(isBasicEntry(entry))
      expect(isInSepaCharset(entry.char, 'basic'), entry.codePoint).toBe(isBasicEntry(entry))
      expect(isInSepaCharset(entry.char, 'extended'), entry.codePoint).toBe(
        isBasicEntry(entry) || isExtendedEntry(entry)
      )
    }
  })

  it('should convert each entry to basic Latin as the table and section 6.2 prescribe', () => {
    for (const entry of TABLE.entries) {
      expect(toSepaCharset(entry.char), `${entry.codePoint} ${entry.name}`).toBe(
        expectedFor(entry, 'basic')
      )
    }
  })

  it('should keep every accepted green and yellow entry in the extended target, converting the rest', () => {
    for (const entry of TABLE.entries) {
      if (isBasicEntry(entry) || isExtendedEntry(entry)) {
        expect(toSepaCharset(entry.char, { charset: 'extended' }), entry.codePoint).toBe(entry.char)
      }
      expect(toSepaCharset(entry.char, { charset: 'extended' }), entry.codePoint).toBe(
        expectedFor(entry, 'extended')
      )
    }
  })

  it('should convert the 7 red entries that NFC maps to another code point as their canonical equivalent', () => {
    const singletons = TABLE.entries
      .filter((entry) => entry.char.normalize('NFC') !== entry.char)
      .map((entry) => [
        entry.codePoint,
        toSepaCharset(entry.char),
        toSepaCharset(entry.char, { charset: 'extended' }),
      ])
    expect(singletons).toEqual([
      ['U+0340', '.', '.'],
      ['U+0341', '.', '.'],
      ['U+0343', '.', '.'],
      ['U+0344', '..', '..'],
      ['U+0374', '.', '.'],
      ['U+037E', ',', ';'],
      ['U+0387', '.', '.'],
    ])
  })

  it('should convert code points of the range rows and unlisted controls to a full stop', () => {
    const samples = [0x0, 0x9, 0xa, 0x1f, 0x460, 0x2019, 0x20ab, 0x20ad, 0x4e2d, 0x1f600, 0x10fffd]
    for (const cp of samples) {
      const character = String.fromCodePoint(cp)
      expect(toSepaCharset(character), cp.toString(16)).toBe('.')
      expect(toSepaCharset(character, { charset: 'extended' }), cp.toString(16)).toBe('.')
    }
  })
})
