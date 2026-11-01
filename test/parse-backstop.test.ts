/**
 * parse() never throws: an unexpected error inside the well-formedness scan (or any
 * other step) becomes { ok: false }. The scan is replaced by one that throws, so the
 * backstop itself is under test.
 */

import { describe, it, expect, vi } from 'vitest'
import { parse } from '../src/parser/parser.js'

const failure = vi.hoisted(() => ({ thrown: undefined as unknown }))

vi.mock('../src/xml-wellformedness.js', () => ({
  findWellFormednessProblem: () => {
    throw failure.thrown
  },
}))

const XML = '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"/>'

describe('parse() backstop', () => {
  it('should return ok:false when the scan throws a RangeError', () => {
    failure.thrown = new RangeError('Maximum call stack size exceeded')
    expect(parse(XML)).toEqual({
      ok: false,
      error: 'Internal parse error: Maximum call stack size exceeded',
    })
  })

  it('should return ok:false when the scan throws a value that is not an Error', () => {
    failure.thrown = 'scan failed'
    expect(parse(XML)).toEqual({ ok: false, error: 'Internal parse error: scan failed' })
  })
})
