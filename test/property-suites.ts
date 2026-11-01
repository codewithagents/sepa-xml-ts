/**
 * Shared property-suite bodies for the extended-charset XSD-oracle and round-trip
 * suites (xsd-oracle.test.ts and iso003-variant.test.ts).
 *
 * Import convention: use './property-suites.js' (NodeNext ESM, .js extension).
 */

import { expect } from 'vitest'
import * as fc from 'fast-check'
import { parse, type ParseOptions } from '../src/parser/parser.js'
import { validateXsd } from '../src/xsd.js'
import type { MessageType } from '../src/message-types.js'

export const PROPERTY_RUNS = 200

function showModel(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v))
}

/** Property: every generated model writes to XML that validates against the official XSD. */
export async function assertXsdOracle<T>(
  arbitrary: fc.Arbitrary<T>,
  write: (doc: T) => string
): Promise<void> {
  let runCount = 0
  await fc.assert(
    fc.asyncProperty(arbitrary, async (doc) => {
      runCount++
      const xml = write(doc)
      const result = await validateXsd(xml)
      if (!result.valid) {
        throw new Error(
          `XSD error at run ${runCount}: ${result.errors.join(', ')}\nModel: ${showModel(doc)}`
        )
      }
    }),
    { numRuns: PROPERTY_RUNS }
  )
  expect(runCount).toBeGreaterThanOrEqual(PROPERTY_RUNS)
}

/** Property: parse(write(model)) deep-equals the model (anchored on the model). */
export function assertRoundTrip<T>(
  arbitrary: fc.Arbitrary<T>,
  write: (doc: T) => string,
  type: MessageType,
  parseOptions?: ParseOptions
): void {
  let runCount = 0
  fc.assert(
    fc.property(arbitrary, (doc) => {
      runCount++
      const result = parse(write(doc), parseOptions)
      if (!result.ok) {
        throw new Error(`parse() failed at run ${runCount}: ${result.error}`)
      }
      expect(result.type).toBe(type)
      expect(result.data).toEqual(doc)
    }),
    { numRuns: PROPERTY_RUNS }
  )
  expect(runCount).toBeGreaterThanOrEqual(PROPERTY_RUNS)
}
